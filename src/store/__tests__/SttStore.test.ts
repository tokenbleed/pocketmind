import * as RNFS from '@dr.pogodin/react-native-fs';
import {PermissionsAndroid} from 'react-native';

// Mock persistence BEFORE importing the store
jest.mock('mobx-persist-store', () => ({
  makePersistable: jest.fn().mockReturnValue(Promise.resolve()),
}));

const mockStartDownload = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/downloads', () => ({
  downloadManager: {
    startDownload: (...args: unknown[]) => mockStartDownload(...args),
    downloadJobs: new Map(),
  },
}));

const mockTranscribeFile = jest.fn().mockResolvedValue('hello world');
jest.mock('../../services/stt/WhisperEngine', () => ({
  WhisperEngine: {
    transcribeFile: (...args: unknown[]) => mockTranscribeFile(...args),
    release: jest.fn().mockResolvedValue(undefined),
    releaseAll: jest.fn().mockResolvedValue(undefined),
  },
}));

import {SttStore} from '../SttStore';
import {WhisperEngine} from '../../services/stt/WhisperEngine';
import {STT_MODELS, sttModelPath} from '../../services/stt/catalog';

describe('SttStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // STT tests want a blank slate: no model files on disk.
    (RNFS.exists as jest.Mock).mockImplementation(async () => false);
    (RNFS.unlink as jest.Mock).mockImplementation(async () => undefined);
    (PermissionsAndroid.request as jest.Mock)?.mockClear?.();
  });

  // Constructor kicks off an async hydrate; let it settle before acting
  // so test actions don't race the on-disk snapshot.
  const freshStore = async () => {
    const store = new SttStore();
    await store.hydrate();
    return store;
  };

  it('hydrates catalog entries from disk', async () => {
    (RNFS.exists as jest.Mock).mockImplementation(
      async (path: string) => path === sttModelPath(STT_MODELS[1]),
    );
    const store = await freshStore();
    await store.hydrate();
    expect(store.modelStates.get(STT_MODELS[1].id)?.status).toBe('ready');
    expect(store.modelStates.get(STT_MODELS[0].id)?.status).toBe(
      'not-downloaded',
    );
  });

  it('defaults to tiny model and reports not ready when absent', async () => {
    const store = await freshStore();
    expect(store.selectedModel?.id).toBe('whisper-tiny-q5_1');
    expect(store.isModelReady).toBe(false);
  });

  it('downloads through the shared download manager', async () => {
    const store = await freshStore();
    await store.downloadModel(STT_MODELS[0].id);
    expect(mockStartDownload).toHaveBeenCalledTimes(1);
    const [modelArg, dest] = mockStartDownload.mock.calls[0];
    expect(modelArg.id).toBe(STT_MODELS[0].id);
    expect(modelArg.downloadUrl).toBe(STT_MODELS[0].url);
    expect(dest).toBe(sttModelPath(STT_MODELS[0]));
    expect(store.modelStates.get(STT_MODELS[0].id)?.status).toBe('downloading');
  });

  it('refuses duplicate downloads and re-downloads of ready models', async () => {
    const store = await freshStore();
    await store.downloadModel(STT_MODELS[0].id);
    await store.downloadModel(STT_MODELS[0].id);
    expect(mockStartDownload).toHaveBeenCalledTimes(1);
  });

  it('deleteModel removes the file and resets state, releasing engine when selected', async () => {
    (RNFS.exists as jest.Mock).mockImplementation(async () => true);
    const store = await freshStore();
    await store.hydrate();
    expect(store.modelStates.get(STT_MODELS[0].id)?.status).toBe('ready');
    await store.deleteModel(STT_MODELS[0].id);
    expect(RNFS.unlink).toHaveBeenCalledWith(sttModelPath(STT_MODELS[0]));
    expect(WhisperEngine.release).toHaveBeenCalled();
    expect(store.modelStates.get(STT_MODELS[0].id)?.status).toBe(
      'not-downloaded',
    );
  });

  it('transcribes with the selected model and deletes the wav afterwards', async () => {
    (RNFS.exists as jest.Mock).mockImplementation(async () => true);
    const store = await freshStore();
    await store.hydrate();
    const text = await store.transcribe('/cache/stt/r.wav');
    expect(text).toBe('hello world');
    expect(mockTranscribeFile).toHaveBeenCalledWith(
      '/cache/stt/r.wav',
      sttModelPath(STT_MODELS[0]),
      'auto',
    );
    expect(RNFS.unlink).toHaveBeenCalledWith('/cache/stt/r.wav');
    expect(store.isTranscribing).toBe(false);
  });

  it('rejects transcription when no model is ready', async () => {
    const store = await freshStore();
    await expect(store.transcribe('/cache/stt/r.wav')).rejects.toThrow(
      /not downloaded/i,
    );
    expect(mockTranscribeFile).not.toHaveBeenCalled();
  });

  it('setSelectedModel releases the engine context on switch', async () => {
    (RNFS.exists as jest.Mock).mockImplementation(async () => true);
    const store = await freshStore();
    await store.hydrate();
    store.setSelectedModel(STT_MODELS[2].id);
    expect(store.selectedModelId).toBe('whisper-small-q5_1');
    expect(WhisperEngine.release).toHaveBeenCalled();
  });

  it('ignores unknown model ids', async () => {
    const store = await freshStore();
    store.setSelectedModel('not-a-model');
    expect(store.selectedModelId).toBe('whisper-tiny-q5_1');
  });
});
