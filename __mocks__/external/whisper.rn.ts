/**
 * Mock of whisper.rn for tests. WhisperEngine is the only consumer; the
 * surface below mirrors exactly what it calls. Tests override the
 * implementations (see SttStore.test.ts) to drive transcripts, loads,
 * and failures.
 */
export const mockTranscribe = jest.fn(() => ({
  promise: Promise.resolve({result: 'hello world', segments: []}),
}));

export const mockContextRelease = jest.fn(() => Promise.resolve());

let nextContext: any = {
  transcribe: mockTranscribe,
  release: mockContextRelease,
};

/** Replace the context object initWhisper will resolve with. */
export const __setContext = (ctx: any) => {
  nextContext = ctx;
};

export const initWhisper = jest.fn(() => Promise.resolve(nextContext));

export const releaseAllWhisper = jest.fn(() => Promise.resolve());

export class WhisperContext {}

export const useWhisper = jest.fn();
