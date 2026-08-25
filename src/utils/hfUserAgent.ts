import DeviceInfo from 'react-native-device-info';

/**
 * User-Agent for outbound Hugging Face requests (API + model downloads).
 * The `(io.github.tokenbleed.pocketmind)` token is a fixed attribution key
 * on both platforms.
 */
export const hfUserAgent = (): string =>
  `PocketMind/${DeviceInfo.getVersion()} (io.github.tokenbleed.pocketmind)`;
