import {Platform} from 'react-native';
import {initWhisper, releaseAllWhisper, WhisperContext} from 'whisper.rn';

/**
 * Lazy singleton around the whisper.cpp context. Loading a model costs
 * real memory (tens of MB), so the context is created on first use and
 * kept until release() is called explicitly (model switch or settings
 * deletion).
 */
class WhisperEngineImpl {
  private context: WhisperContext | null = null;
  private loadedPath: string | null = null;
  private loading: Promise<WhisperContext> | null = null;

  /** True when a context is loaded from exactly this model path. */
  isLoadedWith(path: string): boolean {
    return this.context !== null && this.loadedPath === path;
  }

  /**
   * Load (or reuse) a context for the given model path. Concurrent calls
   * share one load; switching models releases the old context first.
   */
  async ensureContext(path: string): Promise<WhisperContext> {
    if (this.context && this.loadedPath === path) {
      return this.context;
    }
    if (this.loading && this.loadedPath === path) {
      return this.loading;
    }
    if (this.context) {
      await this.release();
    }
    this.loadedPath = path;
    this.loading = initWhisper({
      filePath: path,
      // whisper.cpp GPU paths here are iOS-only; keep Android on CPU
      // where the CPU backend is the one llama.rn benchmarks too.
      useGpu: Platform.OS === 'ios',
    }).then(ctx => {
      this.context = ctx;
      return ctx;
    });
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /**
   * Transcribe a 16 kHz mono WAV file. `language` is an ISO code or
   * 'auto'. Resolves with the trimmed transcript (empty when nothing
   * recognizable was spoken).
   */
  async transcribeFile(
    path: string,
    modelPath: string,
    language: string = 'auto',
  ): Promise<string> {
    const ctx = await this.ensureContext(modelPath);
    const {promise} = ctx.transcribe(path, {
      language,
      // 5 is whisper.cpp's default; keep it explicit for stability.
      beamSize: 5,
      maxThreads: 4,
    });
    const result = await promise;
    return result.result.trim();
  }

  /** Release the context (if any). Safe to call repeatedly. */
  async release(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.loadedPath = null;
    if (ctx) {
      await ctx.release().catch(() => undefined);
    }
  }

  /** Release every whisper context in the process. */
  async releaseAll(): Promise<void> {
    this.context = null;
    this.loadedPath = null;
    await releaseAllWhisper().catch(() => undefined);
  }
}

export const WhisperEngine = new WhisperEngineImpl();
