import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  action,
  computed,
  makeAutoObservable,
  reaction,
  runInAction,
} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_STT_MODEL_ID,
  findSttModel,
  STT_MODELS,
  sttModelPath,
  type SttModelEntry,
} from '../services/stt/catalog';
import {WhisperEngine} from '../services/stt/WhisperEngine';
import {downloadManager} from '../services/downloads';
import type {Model} from '../utils/types';

export type SttModelStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'ready'
  | 'error';

export interface SttModelState {
  status: SttModelStatus;
  /** 0..1 while downloading. */
  progress: number;
  error: string | null;
}

const initialState = (
  status: SttModelStatus,
  error: string | null = null,
): SttModelState => ({
  status,
  progress: 0,
  error,
});

/**
 * Owns on-device STT: which whisper model is installed/selected, its
 * download lifecycle, and the transcribe action used by the composer.
 *
 * Download plumbing reuses downloadManager (WorkManager-backed); its
 * callback slots belong to ModelStore, so this store tracks jobs through
 * a reaction on the observable downloadJobs map instead.
 */
export class SttStore {
  selectedModelId: string = DEFAULT_STT_MODEL_ID;
  modelStates = new Map<string, SttModelState>();

  /** True while a recording is being transcribed. */
  isTranscribing = false;
  lastError: string | null = null;

  constructor() {
    makeAutoObservable(this, {
      selectedModel: computed,
      isModelReady: computed,
      hydrate: action,
      transcribe: action,
    });
    makePersistable(this, {
      name: 'pocketmind.stt',
      properties: ['selectedModelId'],
      storage: AsyncStorage,
    });
    this.watchDownloads();
    void this.hydrate();
  }

  @computed
  get selectedModel(): SttModelEntry | undefined {
    return (
      findSttModel(this.selectedModelId) ?? findSttModel(DEFAULT_STT_MODEL_ID)
    );
  }

  /** True when the selected model file exists and is marked ready. */
  @computed
  get isModelReady(): boolean {
    const model = this.selectedModel;
    return (
      model !== undefined && this.modelStates.get(model.id)?.status === 'ready'
    );
  }

  @action
  setSelectedModel = (id: string): void => {
    if (!findSttModel(id)) {
      return;
    }
    this.selectedModelId = id;
    // Context must be re-created against the new model file.
    WhisperEngine.release().catch(() => undefined);
  };

  /** Re-derive on-disk state (first launch, after download, after delete). */
  @action
  hydrate = async (): Promise<void> => {
    for (const entry of STT_MODELS) {
      const state = this.modelStates.get(entry.id);
      if (state?.status === 'downloading') {
        continue;
      }
      const exists = await RNFS.exists(sttModelPath(entry));
      this.modelStates.set(
        entry.id,
        state?.status === 'error'
          ? state
          : initialState(exists ? 'ready' : 'not-downloaded'),
      );
    }
  };

  @action
  downloadModel = async (id: string): Promise<void> => {
    const entry = findSttModel(id);
    if (!entry) {
      return;
    }
    const current = this.modelStates.get(id);
    if (current?.status === 'downloading' || current?.status === 'ready') {
      return;
    }
    this.modelStates.set(id, initialState('downloading'));
    const stub = {
      id: entry.id,
      downloadUrl: entry.url,
      size: entry.sizeBytes,
    } as unknown as Model;
    try {
      await downloadManager.startDownload(stub, sttModelPath(entry));
    } catch (err) {
      runInAction(() => {
        this.modelStates.set(
          id,
          initialState(
            'not-downloaded',
            err instanceof Error ? err.message : String(err),
          ),
        );
      });
    }
  };

  @action
  deleteModel = async (id: string): Promise<void> => {
    const entry = findSttModel(id);
    if (!entry) {
      return;
    }
    const path = sttModelPath(entry);
    if (await RNFS.exists(path)) {
      await RNFS.unlink(path).catch(() => undefined);
    }
    if (this.selectedModelId === id) {
      await WhisperEngine.release().catch(() => undefined);
    }
    this.modelStates.set(id, initialState('not-downloaded'));
  };

  /**
   * Transcribe a 16 kHz mono WAV file with the selected model.
   * Resolves with the transcript (possibly empty). Deletes the WAV when
   * done; callers never manage the temp file.
   */
  @action
  transcribe = async (
    wavPath: string,
    language: string = 'auto',
  ): Promise<string> => {
    const model = this.selectedModel;
    if (!model || this.modelStates.get(model.id)?.status !== 'ready') {
      throw new Error('STT model is not downloaded');
    }
    this.isTranscribing = true;
    this.lastError = null;
    try {
      return await WhisperEngine.transcribeFile(
        wavPath,
        sttModelPath(model),
        language,
      );
    } catch (err) {
      runInAction(() => {
        this.lastError = err instanceof Error ? err.message : String(err);
      });
      throw err;
    } finally {
      runInAction(() => {
        this.isTranscribing = false;
      });
      RNFS.unlink(wavPath).catch(() => undefined);
    }
  };

  /**
   * Snapshot the shared download map for catalog ids. Mobx tracks the
   * map reads inside the expression, so any add/update/remove of a
   * relevant job re-runs the effect. Completion is not signalled
   * anywhere observable, so a vanished job is resolved by checking the
   * file on disk.
   */
  private watchDownloads(): void {
    reaction(
      () =>
        STT_MODELS.map(entry => {
          const job = downloadManager.downloadJobs.get(entry.id);
          return {
            id: entry.id,
            downloading: job?.state.isDownloading ?? false,
            progress: job?.state.progress?.progress ?? 0,
            present: job !== undefined,
          };
        }),
      snapshot => {
        runInAction(() => {
          for (const snap of snapshot) {
            if (snap.downloading) {
              this.modelStates.set(snap.id, {
                status: 'downloading',
                progress: snap.progress,
                error: null,
              });
            } else if (
              this.modelStates.get(snap.id)?.status === 'downloading' &&
              !snap.present
            ) {
              // Job vanished: completed, cancelled, or failed. Disk is
              // the source of truth.
              RNFS.exists(sttModelPath(findSttModel(snap.id)!))
                .then(exists =>
                  runInAction(() => {
                    this.modelStates.set(
                      snap.id,
                      initialState(exists ? 'ready' : 'not-downloaded'),
                    );
                  }),
                )
                .catch(() => undefined);
            }
          }
        });
      },
      {fireImmediately: true},
    );
  }
}

export const sttStore = new SttStore();
