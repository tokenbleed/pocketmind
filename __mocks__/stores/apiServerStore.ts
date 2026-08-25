import {makeAutoObservable} from 'mobx';

/**
 * Jest mock for the ApiServerStore singleton. Mirrors the real store's
 * observable shape; tests mutate fields directly or spy on the methods.
 */
class MockApiServerStore {
  port = 8080;
  bindLan = false;
  apiKey = '';
  running = false;
  address: string | null = null;
  lastError: string | null = null;
  available = true;

  constructor() {
    makeAutoObservable(this);
    this.setPort = this.setPort.bind(this);
    this.setBindLan = this.setBindLan.bind(this);
    this.setApiKey = this.setApiKey.bind(this);
    this.start = jest.fn(() => Promise.resolve('127.0.0.1:8080'));
    this.stop = jest.fn(() => Promise.resolve());
  }

  setPort(_port: number): void {}
  setBindLan(_bindLan: boolean): void {}
  setApiKey(_key: string): void {}
  async start(): Promise<string | null> {
    return '127.0.0.1:8080';
  }
  async stop(): Promise<void> {}
}

export const mockApiServerStore = new MockApiServerStore();
