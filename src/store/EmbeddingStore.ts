/**
 * Lifecycle for the knowledge base's embedding model: a second, small
 * llama.rn context (mean pooling) that coexists with the chat model.
 * Loading is lazy - the context is only created when a document is
 * actually indexed or a query is embedded, and released after idle so
 * a 33-600MB embedding model never sits in RAM unused.
 */
import {AppState} from 'react-native';

import {LlamaContext, initLlama} from 'llama.rn';
import {makeAutoObservable, runInAction} from 'mobx';

import * as RNFS from '@dr.pogodin/react-native-fs';

import {getPreset} from '../utils/rag/presets';
import {l2Normalize} from '../utils/rag/vectorStore';
import {getRecommendedThreadCount} from '../utils/deviceCapabilities';

export const EMBEDDING_MODELS_DIR = `${RNFS.DocumentDirectoryPath}/kb-models`;

export const modelPathFor = (presetId: string): string =>
  `${EMBEDDING_MODELS_DIR}/${presetId}.gguf`;

export const isEmbeddingModelDownloaded = async (
  presetId: string,
): Promise<boolean> => {
  try {
    return await RNFS.exists(modelPathFor(presetId));
  } catch {
    return false;
  }
};

/** Release an idle embedding context after this many ms. Long enough
 * that a back-and-forth chat keeps the model warm; a backgrounded app
 * releases immediately via the AppState listener. */
const IDLE_RELEASE_MS = 10 * 60_000;

class EmbeddingStore {
  context: LlamaContext | null = null;
  contextPresetId: string | null = null;
  isLoading = false;
  loadError: string | null = null;

  private releaseTimer: ReturnType<typeof setTimeout> | null = null;

  /** Serializes all native embedding-context work. llama.rn throws
   * "Context is busy" when a second embedding()/release() arrives while
   * one is in flight, and two call sites can genuinely race (background
   * document indexing vs. the retrieval query embed at message send).
   * Every public path funnels through this queue, so at most one native
   * call is ever outstanding on the embedding context. */
  private nativeQueue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.nativeQueue.then(op, op);
    // Keep the chain alive regardless of the previous op's outcome.
    this.nativeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Cached CPU recommendation so repeated context creation does not
   * re-query DeviceInfo. Null until first resolved. */
  private recommendedThreads: number | null = null;

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true});

    // Free the embedding model's RAM as soon as the app leaves the
    // foreground; the next embed() lazily reloads it (mmap, so cheap).
    const appStateChange = (state: string) => {
      if (state !== 'active') {
        void this.release();
      }
    };
    AppState.addEventListener('change', appStateChange);
  }

  private async create(presetId: string): Promise<LlamaContext> {
    const preset = getPreset(presetId);
    if (!preset) {
      throw new Error(`Unknown embedding preset: ${presetId}`);
    }
    // Threads: match the chat model's recommendation (80% of cores on
    // 6+ core devices, all cores below). Indexing is pure CPU, so this
    // is the single biggest speed lever for large documents.
    if (this.recommendedThreads == null) {
      try {
        this.recommendedThreads = await getRecommendedThreadCount();
      } catch {
        this.recommendedThreads = 4;
      }
    }
    const embeddingThreads = this.recommendedThreads;
    const path = modelPathFor(presetId);
    if (!(await RNFS.exists(path))) {
      throw new Error(
        `Embedding model ${preset.label} is not downloaded (${path})`,
      );
    }

    runInAction(() => {
      this.isLoading = true;
      this.loadError = null;
    });

    try {
      const context = await initLlama({
        model: path,
        n_ctx: 2048,
        n_batch: 512,
        // Required or the native layer rejects every embedding() call
        // with "Embedding is not enabled".
        embedding: true,
        // llama.rn maps the string to the native enum (mean = MEAN pooling).
        pooling_type: 'mean',
        use_mmap: true,
        // Embedding passes are single-shot and tiny; the chat model's
        // context is NOT resident during indexing (separate store), so
        // the full recommended thread count does not contend with chat.
        n_threads: embeddingThreads,
      });
      runInAction(() => {
        this.context = context;
        this.contextPresetId = presetId;
        this.isLoading = false;
      });
      return context;
    } catch (err) {
      runInAction(() => {
        this.isLoading = false;
        this.loadError =
          err instanceof Error ? err.message : 'Failed to load embedding model';
      });
      throw err;
    }
  }

  /**
   * Get (or lazily create) the embedding context for a preset. Swaps
   * contexts if the requested preset differs from the loaded one.
   */
  async ensureContext(presetId: string): Promise<LlamaContext> {
    this.scheduleIdleRelease();
    if (this.context && this.contextPresetId === presetId) {
      return this.context;
    }
    if (this.context) {
      // Internal swap path: we may already be inside a queued op, so
      // this must NOT re-enter nativeQueue (it would self-deadlock).
      await this.releaseNow();
    }
    return this.create(presetId);
  }

  /** Embed one text, L2-normalized. Truncation happens natively at n_ctx.
   * Serialized: see nativeQueue. */
  async embed(text: string, presetId: string): Promise<Float32Array> {
    return this.enqueue(async () => {
      const context = await this.ensureContext(presetId);
      this.scheduleIdleRelease();
      const result = await context.embedding(text, {
        // 2 = L2 normalization in llama.cpp's embd_normalize.
        embd_normalize: 2,
      });
      return l2Normalize(result.embedding);
    });
  }

  private scheduleIdleRelease(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
    }
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      void this.release();
    }, IDLE_RELEASE_MS);
  }

  /** Warm the embedding context without embedding anything: hides the
   * model-load latency (mmap, ~1s) behind file extraction. Fire-and-
   * forget safe; errors are swallowed by the caller. */
  async prewarm(presetId: string): Promise<void> {
    await this.enqueue(() => this.ensureContext(presetId));
  }

  async release(): Promise<void> {
    // Routed through the queue so a release can never land between an
    // in-flight embed and its native call (the AppState background
    // listener fires while indexing may be running).
    await this.enqueue(() => this.releaseNow());
  }

  /** Internal, UNSYNCHRONIZED release. Callers already hold nativeQueue
   * (embed/prewarm swap path) or have drained it (public release). */
  private async releaseNow(): Promise<void> {
    const ctx = this.context;
    if (!ctx) {
      return;
    }
    runInAction(() => {
      this.context = null;
      this.contextPresetId = null;
    });
    try {
      await ctx.release();
    } catch (err) {
      console.warn('[EmbeddingStore] release failed:', err);
    }
  }
}

export const embeddingStore = new EmbeddingStore();
