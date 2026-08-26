import React from 'react';
import {fireEvent, waitFor} from '@testing-library/react-native';
import {PermissionsAndroid, Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {render} from '../../../../jest/test-utils';
import {SttMicButton} from '../SttMicButton';
import NativeSttRecorder from '../../../specs/NativeSttRecorder';
import {mockTranscribe} from '../../../../__mocks__/external/whisper.rn';
import {sttStore} from '../../../store/SttStore';

describe('SttMicButton', () => {
  let savedOS: typeof Platform.OS;
  let checkSpy: jest.SpyInstance;
  let requestSpy: jest.SpyInstance;

  beforeAll(() => {
    // Recorder flow is Android-only today; the jest preset defaults to ios.
    savedOS = Platform.OS;
    Platform.OS = 'android';
    checkSpy = jest
      .spyOn(PermissionsAndroid, 'check')
      .mockResolvedValue(true as never);
    requestSpy = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED as never);
  });

  afterAll(() => {
    Platform.OS = savedOS;
    checkSpy.mockRestore();
    requestSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockImplementation(async () => true);
    (RNFS.unlink as jest.Mock).mockImplementation(async () => undefined);
    (NativeSttRecorder.start as jest.Mock)
      .mockClear()
      .mockResolvedValue('/cache/stt/recording-test.wav');
    (NativeSttRecorder.stop as jest.Mock)
      .mockClear()
      .mockResolvedValue('/cache/stt/recording-test.wav');
  });

  const markReady = async () => {
    await sttStore.hydrate();
  };

  it('renders the mic button', async () => {
    const {getByTestId} = render(<SttMicButton onTranscript={jest.fn()} />);
    expect(getByTestId('stt-mic-button')).toBeTruthy();
  });

  it('opens the download sheet when no model is ready', async () => {
    (RNFS.exists as jest.Mock).mockImplementation(async () => false);
    await sttStore.hydrate();
    const {getByTestId, queryByTestId} = render(
      <SttMicButton onTranscript={jest.fn()} />,
    );
    expect(queryByTestId('stt-download-sheet')).toBeNull();
    fireEvent.press(getByTestId('stt-mic-button'));
    expect(getByTestId('stt-download-sheet')).toBeTruthy();
  });

  it('records, stops, and hands the transcript back', async () => {
    await markReady();
    const onTranscript = jest.fn();
    const {getByTestId, queryByTestId} = render(
      <SttMicButton onTranscript={onTranscript} />,
    );

    fireEvent.press(getByTestId('stt-mic-button'));
    // The press handler awaits the permission check before calling
    // start, so wait for the observable side effect rather than a tick.
    await waitFor(() =>
      expect(NativeSttRecorder.start).toHaveBeenCalledTimes(1),
    );
    // The re-render that flips phase to 'recording' also lands here.
    await waitFor(() => expect(getByTestId('stt-timer')).toBeTruthy());

    fireEvent.press(getByTestId('stt-mic-button'));
    await waitFor(() =>
      expect(NativeSttRecorder.stop).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith('hello world'),
    );
    expect(queryByTestId('stt-transcribing')).toBeNull();
  });

  it('shows a hint instead of calling back when nothing was said', async () => {
    await markReady();
    mockTranscribe.mockImplementationOnce(() => ({
      promise: Promise.resolve({result: '   ', segments: []}),
    }));
    const onTranscript = jest.fn();
    const {getByTestId, queryByTestId} = render(
      <SttMicButton onTranscript={onTranscript} />,
    );

    fireEvent.press(getByTestId('stt-mic-button'));
    await waitFor(() =>
      expect(NativeSttRecorder.start).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(getByTestId('stt-timer')).toBeTruthy());

    fireEvent.press(getByTestId('stt-mic-button'));
    // Stop -> transcribe -> empty result settles back to idle.
    await waitFor(() =>
      expect(NativeSttRecorder.stop).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(queryByTestId('stt-timer')).toBeNull());
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
