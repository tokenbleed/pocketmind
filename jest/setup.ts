import 'react-native-gesture-handler/jestSetup';
import mockClipboard from '@react-native-clipboard/clipboard/jest/clipboard-mock.js';

import 'react-native-gesture-handler/jestSetup';

// __E2E__ is a build-time constant in prod builds (see babel.config.js),
// but in Jest the transform-define plugin is disabled so it stays a runtime
// global. Default to true so tests can render __E2E__-gated paths; tests
// that assert the gate override with `(global as any).__E2E__ = false`.
(global as any).__E2E__ = true;
// Onboarding bypass flag: default off in Jest; tests that need the
// bypass-on path override with `(global as any).__E2E_SKIP_ONBOARDING__ = true`.
(global as any).__E2E_SKIP_ONBOARDING__ = false;

jest.mock('react-native-haptic-feedback');

jest.mock('react-native-keyboard-controller', () => {
  const KeyboardControllerMock = require('react-native-keyboard-controller/jest');
  return KeyboardControllerMock;
});

// Mock react-native-reanimated
//require('react-native-reanimated').setUpTests();
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');

  Reanimated.default.call = () => {};

  Reanimated.useReducedMotion = jest.fn(() => false);

  Reanimated.useSharedValue = jest.fn(() => ({value: 0}));
  Reanimated.useAnimatedStyle = jest.fn(() => ({}));
  Reanimated.useAnimatedScrollHandler = jest.fn(() => ({}));
  Reanimated.useAnimatedProps = jest.fn(() => ({}));
  Reanimated.useAnimatedGestureHandler = jest.fn(() => ({}));
  Reanimated.withTiming = jest.fn(() => ({}));
  Reanimated.withSpring = jest.fn(() => ({}));
  Reanimated.cancelAnimation = jest.fn();

  Reanimated.default.createAnimatedComponent = (Component: any) => Component;

  return Reanimated;
});

jest.mock('@react-navigation/elements', () => ({
  ...jest.requireActual('@react-navigation/elements'),
  useHeaderHeight: jest.fn().mockReturnValue(56), // Provide a mock return value
}));

import {mockUiStore} from '../__mocks__/stores/uiStore';
import {mockHFStore} from '../__mocks__/stores/hfStore';
import {mockModelStore} from '../__mocks__/stores/modelStore';
import {
  mockChatSessionStore,
  mockDefaultCompletionSettings,
} from '../__mocks__/stores/chatSessionStore';
import {benchmarkStore as mockBenchmarkStore} from '../__mocks__/stores/benchmarkStore';
import {mockPalStore} from '../__mocks__/stores/palStore';
import {deepLinkStore as mockDeepLinkStore} from '../__mocks__/stores/deepLinkStore';
import {mockServerStore} from '../__mocks__/stores/serverStore';
import {mockTTSStore} from '../__mocks__/stores/ttsStore';
import {checkoutFlowStore as mockCheckoutFlowStore} from '../__mocks__/stores/checkoutFlowStore';
import {mockSearchProviderStore} from '../__mocks__/stores/searchProviderStore';
import {mockAgentFsStore} from '../__mocks__/stores/agentFsStore';
import {mockApiServerStore} from '../__mocks__/stores/apiServerStore';
import {mockKnowledgeBaseStore} from '../__mocks__/stores/knowledgeBaseStore';
import {mockPoolStore} from '../__mocks__/stores/poolStore';
import {mockEmbeddingStore} from '../__mocks__/stores/embeddingStore';

jest.mock('@react-native-clipboard/clipboard', () => mockClipboard);

jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

// Mock NativeHardwareInfo TurboModule
jest.mock('../src/specs/NativeHardwareInfo', () => ({
  __esModule: true,
  default: {
    getCPUInfo: jest.fn(() => Promise.resolve({cores: 4})),
    getGPUInfo: jest.fn(() =>
      Promise.resolve({
        renderer: 'Mock GPU',
        vendor: 'Mock Vendor',
        version: 'Mock Version',
        hasAdreno: false,
        hasMali: false,
        hasPowerVR: false,
        supportsOpenCL: false,
        gpuType: 'Mock GPU',
      }),
    ),
    getChipset: jest.fn(() => Promise.resolve('Mock Chipset')),
    getAvailableMemory: jest.fn(() => Promise.resolve(3 * 1000 * 1000 * 1000)), // 3GB
    writeMemorySnapshot: jest.fn((label: string) =>
      Promise.resolve({label, status: 'written'}),
    ),
    purgeNativeAllocator: jest.fn(() =>
      Promise.resolve({purged: true, rss_kb_before: 0, rss_kb_after: 0}),
    ),
  },
}));

// Mock SafFs TurboModule (Storage Access Bridge). Device-root tests
// override the individual jest.fn implementations; the defaults model
// "nothing mounted" so workspace-only tests are unaffected.
jest.mock('../src/specs/NativeSafFs', () => ({
  __esModule: true,
  default: {
    stat: jest.fn(() =>
      Promise.resolve({exists: false, isDir: false, size: 0, mtime: null}),
    ),
    listDir: jest.fn(() => Promise.resolve([])),
    readFile: jest.fn(() =>
      Promise.reject(new Error('SafFs.readFile not configured in test')),
    ),
    writeFile: jest.fn(() =>
      Promise.reject(new Error('SafFs.writeFile not configured in test')),
    ),
  },
}));

// Mock the local API server TurboModule. Router tests override the
// respond jest.fns; start/stop defaults are inert.
jest.mock('../src/specs/NativeApiServer', () => ({
  __esModule: true,
  default: {
    start: jest.fn(() => Promise.resolve('127.0.0.1:8080')),
    stop: jest.fn(() => Promise.resolve()),
    respond: jest.fn(),
    respondStreamChunk: jest.fn(),
    respondStreamEnd: jest.fn(),
    respondStreamFail: jest.fn(),
  },
}));

// Mock the share-intent TurboModule. Tests override takePendingText per
// case; the default models "nothing parked".
jest.mock('../src/specs/NativeShareIntent', () => ({
  __esModule: true,
  default: {
    takePendingText: jest.fn(() => Promise.resolve(null)),
  },
}));

// Mock the STT recorder TurboModule. Tests override start/stop per
// case; defaults model an idle recorder with a fixed WAV path.
jest.mock('../src/specs/NativeSttRecorder', () => ({
  __esModule: true,
  default: {
    start: jest.fn(() => Promise.resolve('/cache/stt/recording-test.wav')),
    stop: jest.fn(() => Promise.resolve('/cache/stt/recording-test.wav')),
    cancel: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const inset = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    SafeAreaProvider: jest.fn(({children}) => children),
    SafeAreaConsumer: jest.fn(({children}) => children(inset)),
    useSafeAreaInsets: jest.fn(() => inset),
    useSafeAreaFrame: jest.fn(() => ({x: 0, y: 0, width: 390, height: 844})),
  };
});

jest.mock('../src/store', () => {
  const {UIStore} = require('../__mocks__/stores/uiStore');
  return {
    modelStore: mockModelStore,
    UIStore,
    uiStore: mockUiStore,
    chatSessionStore: mockChatSessionStore,
    hfStore: mockHFStore,
    benchmarkStore: mockBenchmarkStore,
    palStore: mockPalStore,
    deepLinkStore: mockDeepLinkStore,
    serverStore: mockServerStore,
    ttsStore: mockTTSStore,
    checkoutFlowStore: mockCheckoutFlowStore,
    searchProviderStore: mockSearchProviderStore,
    agentFsStore: mockAgentFsStore,
    apiServerStore: mockApiServerStore,
    knowledgeBaseStore: mockKnowledgeBaseStore,
    poolStore: mockPoolStore,
    embeddingStore: mockEmbeddingStore,
    defaultCompletionSettings: mockDefaultCompletionSettings,
  };
});

jest.mock('../src/hooks/useTheme', () => {
  const {themeFixtures} = require('./fixtures/theme');
  return {
    useTheme: jest.fn().mockReturnValue(themeFixtures.lightTheme),
  };
});

jest.mock('../src/hooks/useMemoryCheck', () => ({
  useMemoryCheck: jest.fn().mockReturnValue({
    memoryWarning: '',
    shortMemoryWarning: '',
    multimodalWarning: '',
  }),
  hasEnoughMemory: jest.fn().mockResolvedValue(true),
  isHighEndDevice: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/downloads', () => ({
  downloadManager: require('../__mocks__/services/downloads').downloadManager,
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid-12345' + Math.random(),
}));

jest.mock('../src/repositories/ChatSessionRepository', () => ({
  chatSessionRepository:
    require('../__mocks__/repositories/ChatSessionRepository')
      .chatSessionRepository,
}));

jest.mock('../src/utils/keepAwake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('../src/utils/foregroundService', () => ({
  startForegroundRun: jest.fn(),
  updateForegroundRun: jest.fn(),
  stopForegroundRun: jest.fn(),
}));

jest.mock('react-native-share', () => ({
  default: jest.fn(),
}));

jest.mock('react-native-image-picker');
jest.mock('react-native-vision-camera');

jest.mock('../src/database', () => {
  return {
    database: require('../__mocks__/database').mockDatabase,
  };
});

jest.mock('../src/services', () => {
  return require('../__mocks__/services');
});
