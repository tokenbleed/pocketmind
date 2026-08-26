import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * Fixed catalog of on-device STT (whisper.cpp) models. These are GGML
 * `ggml-*.bin` files, deliberately NOT part of the chat-model catalog:
 * they live under models/stt/ and are managed by SttStore only.
 *
 * Sizes are the publish-time content lengths from the source repo and are
 * used only for the storage-space pre-check and progress display.
 */
export interface SttModelEntry {
  id: string;
  /** Display label shown in settings. */
  label: string;
  /** One-line description shown in settings. */
  description: string;
  url: string;
  sizeBytes: number;
  /** Target filename inside models/stt/. */
  filename: string;
}

export const STT_MODEL_DIR = `${RNFS.DocumentDirectoryPath}/models/stt`;

export const STT_MODELS: SttModelEntry[] = [
  {
    id: 'whisper-tiny-q5_1',
    label: 'Whisper Tiny (Q5_1)',
    description: '31 MB, English-focused, fastest',
    url: 'https://huggingface.co/ggml-org/whisper/resolve/main/ggml-tiny-q5_1.bin',
    sizeBytes: 31_279_549,
    filename: 'ggml-tiny-q5_1.bin',
  },
  {
    id: 'whisper-base-q5_1',
    label: 'Whisper Base (Q5_1)',
    description: '57 MB, balanced accuracy and speed',
    url: 'https://huggingface.co/ggml-org/whisper/resolve/main/ggml-base-q5_1.bin',
    sizeBytes: 57_555_837,
    filename: 'ggml-base-q5_1.bin',
  },
  {
    id: 'whisper-small-q5_1',
    label: 'Whisper Small (Q5_1)',
    description: '181 MB, best accuracy, slowest',
    url: 'https://huggingface.co/ggml-org/whisper/resolve/main/ggml-small-q5_1.bin',
    sizeBytes: 181_460_925,
    filename: 'ggml-small-q5_1.bin',
  },
];

/** Default catalog entry used when nothing has been selected yet. */
export const DEFAULT_STT_MODEL_ID = 'whisper-tiny-q5_1';

export const sttModelPath = (entry: SttModelEntry): string =>
  `${STT_MODEL_DIR}/${entry.filename}`;

export const findSttModel = (id: string): SttModelEntry | undefined =>
  STT_MODELS.find(m => m.id === id);
