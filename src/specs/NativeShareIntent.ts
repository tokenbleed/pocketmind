import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Share-intent bridge: text sent to the app from the Android share
 * sheet (ACTION_SEND) or the text-selection menu (ACTION_PROCESS_TEXT).
 *
 * The activity captures the text into a native holder; JS drains it
 * exactly once via takePendingText(). The `sharedText` device event is
 * only a poke for the warm path - it carries no data, so a missed or
 * replayed event cannot double-deliver.
 */
export interface Spec extends TurboModule {
  /**
   * Return and clear the parked share text, or null when nothing is
   * waiting (already consumed, or no share intent).
   */
  takePendingText(): Promise<string | null>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ShareIntent');
