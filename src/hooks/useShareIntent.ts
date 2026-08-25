/**
 * useShareIntent Hook
 *
 * Android share sheet (ACTION_SEND) and text-selection menu
 * (ACTION_PROCESS_TEXT) handling. Native parks the text and pokes us
 * with a payload-less `sharedText` event; this hook drains the text
 * exactly once (cold start via mount-time pull, warm via the poke) and
 * parks it in deepLinkStore so ChatScreen prefills its input with the
 * shared text. Nothing is ever sent to the model without the user
 * pressing send.
 *
 * Must be called from a component inside NavigationContainer.
 */

import {useEffect, useCallback} from 'react';
import {DeviceEventEmitter, Platform} from 'react-native';
import {useNavigation} from '@react-navigation/native';

import NativeShareIntent from '../specs/NativeShareIntent';
import {deepLinkStore} from '../store';
import {ROUTES} from '../utils/navigationConstants';

export const useShareIntent = () => {
  const navigation = useNavigation();

  const drainSharedText = useCallback(async () => {
    try {
      const text = await NativeShareIntent.takePendingText();
      if (text && text.trim()) {
        deepLinkStore.setPendingMessage(text);
        (navigation as any).navigate(ROUTES.CHAT);
      }
    } catch {
      // The native side rejects only when the module is missing (e.g.
      // the app resumed on another platform); there is nothing to drain.
    }
  }, [navigation]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    // Cold start: the activity parked the text before JS was running.
    drainSharedText();

    // Warm share: native pokes us; the text itself is drained from the
    // holder, so a replayed poke is a no-op.
    const sub = DeviceEventEmitter.addListener('sharedText', () => {
      drainSharedText();
    });

    return () => {
      sub.remove();
    };
  }, [drainSharedText]);
};
