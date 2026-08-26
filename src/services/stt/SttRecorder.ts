import {PermissionsAndroid, Platform} from 'react-native';

import NativeSttRecorder from '../../specs/NativeSttRecorder';

/**
 * Thin wrapper around the native recorder: owns the RECORD_AUDIO runtime
 * permission flow and exposes start/stop/cancel with typed errors.
 */
export class SttPermissionDeniedError extends Error {
  constructor() {
    super('microphone permission denied');
    this.name = 'SttPermissionDeniedError';
  }
}

const requestMicPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return false;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO!,
    {
      title: 'Microphone access',
      message:
        'Voice input uses the microphone to transcribe speech on-device.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
};

/** Returns true when RECORD_AUDIO is granted, requesting it if needed. */
export const ensureMicPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return false;
  }
  const current = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO!,
  );
  if (current) {
    return true;
  }
  return requestMicPermission();
};

export const SttRecorder = {
  /** Start recording; resolves with the WAV path. Throws SttPermissionDeniedError. */
  start: async (): Promise<string> => {
    const granted = await ensureMicPermission();
    if (!granted) {
      throw new SttPermissionDeniedError();
    }
    return NativeSttRecorder.start();
  },

  /** Stop recording and finalize the WAV; resolves with the path. */
  stop: (): Promise<string> => NativeSttRecorder.stop(),

  /** Stop and discard. Always safe to call. */
  cancel: (): Promise<void> => NativeSttRecorder.cancel(),
};
