// Navigation route names
export const ROUTES = {
  // Main app routes
  CHAT: 'Chat',
  MODELS: 'Models',
  PALS: 'Pals (experimental)',
  KNOWLEDGE_BASE: 'Knowledge Base',
  WORKSPACE: 'Workspace',
  BENCHMARK: 'Benchmark',
  SETTINGS: 'Settings',
  APP_INFO: 'App Info',

  // Dev tools route. Only available in debug mode.
  DEV_TOOLS: 'Dev Tools',

  // Onboarding stack routes (mounted via OnboardingStack when
  // uiStore.hasCompletedOnboarding is false; see App.tsx SwitchPoint).
  ONBOARDING: {
    SPLASH: 'OnboardingSplash',
    STEP_1: 'Onboarding1',
    STEP_2: 'Onboarding2',
    STEP_3: 'Onboarding3',
    STEP_4: 'Onboarding4',
    STEP_5: 'Onboarding5',
    STEP_6: 'Onboarding6',
  } as const,
} as const;
