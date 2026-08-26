import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Raw mono 16 kHz PCM16 recorder feeding on-device STT. The WAV file it
 * produces is exactly what whisper.cpp consumes; no transcoding happens
 * in JS.
 */
export interface Spec extends TurboModule {
  /**
   * Begin recording. Resolves with the absolute path of the WAV file
   * being written (in the app cache dir). Rejects with code
   * ALREADY_RECORDING / PERMISSION_DENIED / START_FAILED.
   */
  start(): Promise<string>;
  /**
   * Stop recording, finalize the WAV header, and resolve with the file
   * path. Rejects with NOT_RECORDING if idle.
   */
  stop(): Promise<string>;
  /**
   * Stop recording (if any) and delete the file. Always resolves.
   */
  cancel(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SttRecorderModule');
