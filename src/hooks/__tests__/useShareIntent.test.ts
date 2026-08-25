/**
 * useShareIntent - Android share-sheet routing tests.
 *
 * Covers the two delivery paths: cold start (mount-time pull) and the
 * warm poke event, plus consume-once semantics (a replayed poke drains
 * nothing) and the no-send contract (text lands in pendingMessage, it
 * is never dispatched to a model).
 */

import {DeviceEventEmitter, Platform} from 'react-native';
import {renderHook} from '@testing-library/react-native';

import {useShareIntent} from '../useShareIntent';
import NativeShareIntent from '../../specs/NativeShareIntent';
import {deepLinkStore} from '../../store';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actualNav = jest.requireActual('@react-navigation/native');
  return {
    ...actualNav,
    useNavigation: () => ({
      navigate: mockNavigate,
      addListener: jest.fn(() => ({remove: jest.fn()})),
      goBack: jest.fn(),
      setOptions: jest.fn(),
      dispatch: jest.fn(),
    }),
  };
});

const takePendingText = NativeShareIntent.takePendingText as jest.Mock;

describe('useShareIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (deepLinkStore as any).pendingMessage = null;
    Platform.OS = 'android';
    takePendingText.mockResolvedValue(null);
  });

  it('drains cold-start text into the pending message and opens chat', async () => {
    takePendingText.mockResolvedValue('look at this');
    renderHook(() => useShareIntent());
    // Let the mount-time drain settle.
    await new Promise(resolve => setImmediate(resolve));

    expect(deepLinkStore.setPendingMessage).toHaveBeenCalledWith(
      'look at this',
    );
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('drains the warm poke event exactly once', async () => {
    renderHook(() => useShareIntent());
    await new Promise(resolve => setImmediate(resolve));
    expect(deepLinkStore.setPendingMessage).not.toHaveBeenCalled();

    takePendingText
      .mockResolvedValueOnce('shared while warm')
      .mockResolvedValue(null);
    DeviceEventEmitter.emit('sharedText', null);
    DeviceEventEmitter.emit('sharedText', null); // replay is a no-op
    await new Promise(resolve => setImmediate(resolve));

    expect(deepLinkStore.setPendingMessage).toHaveBeenCalledTimes(1);
    expect(deepLinkStore.setPendingMessage).toHaveBeenCalledWith(
      'shared while warm',
    );
  });

  it('ignores blank parked text without navigating', async () => {
    takePendingText.mockResolvedValue('   ');
    renderHook(() => useShareIntent());
    await new Promise(resolve => setImmediate(resolve));

    expect(deepLinkStore.setPendingMessage).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('swallows a missing native module instead of crashing', async () => {
    takePendingText.mockRejectedValue(new Error('not registered'));
    renderHook(() => useShareIntent());
    await new Promise(resolve => setImmediate(resolve));

    expect(deepLinkStore.setPendingMessage).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('subscribes only on Android', () => {
    Platform.OS = 'ios';
    renderHook(() => useShareIntent());
    expect(takePendingText).not.toHaveBeenCalled();
  });
});
