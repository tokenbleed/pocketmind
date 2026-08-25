/**
 * useDeepLinking - deep-link routing regression tests.
 *
 * Covers the handler registered with deepLinkService: chat-host links route
 * to the chat screen and must not touch the checkout flow. Hub/run dispatch
 * (prod Linking path) is covered by useDeepLinking.hubRun.test.ts.
 */

import {Linking} from 'react-native';
import {renderHook} from '@testing-library/react-native';

import {useDeepLinking} from '../useDeepLinking';
import {deepLinkService} from '../../services/DeepLinkService';
import {checkoutFlowStore, chatSessionStore, palStore} from '../../store';

jest.mock('@react-navigation/native', () => {
  const actualNav = jest.requireActual('@react-navigation/native');
  return {
    ...actualNav,
    useNavigation: () => ({
      navigate: jest.fn(),
      addListener: jest.fn(() => ({remove: jest.fn()})),
      goBack: jest.fn(),
      setOptions: jest.fn(),
      dispatch: jest.fn(),
    }),
  };
});

// Stub the iOS-only DeepLinkService so its native path is inert in tests;
// the handler it registers is what these tests drive directly.
jest.mock('../../services/DeepLinkService', () => ({
  deepLinkService: {
    initialize: jest.fn(),
    addListener: jest.fn(() => () => {}),
    cleanup: jest.fn(),
  },
}));

describe('useDeepLinking - deep-link routing', () => {
  // The registered deep-link handler, captured from deepLinkService.addListener.
  const getHandler = (): ((params: any) => Promise<void>) => {
    const addListener = deepLinkService.addListener as jest.Mock;
    return addListener.mock.calls[addListener.mock.calls.length - 1][0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  });

  it('does not route checkout for the chat host link (no regression)', async () => {
    (palStore as any).pals = [{id: 'p1'}];
    renderHook(() => useDeepLinking());
    await getHandler()({
      url: 'pocketpal://chat?palId=p1',
      scheme: 'pocketpal',
      host: 'chat',
      queryParams: {palId: 'p1'},
    });
    expect(checkoutFlowStore.onReturn).not.toHaveBeenCalled();
    expect(chatSessionStore.setActivePal).toHaveBeenCalledWith('p1');
  });
});
