import {Platform} from 'react-native';

// Device rules overlay, self-hosted in this repo (same files that ship as
// the bundled offline floor under src/store/bundledDeviceRules). Raw GitHub
// serves them, so rule updates land with a normal push to main.
const RULES_BASE =
  'https://raw.githubusercontent.com/tokenbleed/pocketmind/main/src/store/bundledDeviceRules';

// The advisory rules repo serves one file per platform. iPadOS reports as
// 'ios', so the iOS rules file covers iPad too.
export const getRulesUrl = (
  platform: 'ios' | 'android' = Platform.OS as 'ios' | 'android',
): string => `${RULES_BASE}/rules.${platform}.json`;
