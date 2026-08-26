export const mockPoolStore = {
  hostEndpoints: '',
  workerPort: 50052,
  workerThreads: 0,
  workerActive: false,
  workerError: null as string | null,

  get rpcServers(): string[] {
    return this.hostEndpoints
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(e));
  },

  setHostEndpoints: jest.fn(function (this: any, value: string) {
    this.hostEndpoints = value;
  }),
  setWorkerPort: jest.fn(),
  setWorkerThreads: jest.fn(),
  startWorker: jest.fn().mockResolvedValue(undefined),
  stopWorker: jest.fn().mockResolvedValue(undefined),
};
