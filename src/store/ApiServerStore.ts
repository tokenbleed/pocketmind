import AsyncStorage from '@react-native-async-storage/async-storage';
import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import {Platform} from 'react-native';

import NativeApiServer from '../specs/NativeApiServer';

const STORAGE_KEY = 'ApiServerStore.v1';
const PROP_PORT = 'port';
const PROP_BIND_LAN = 'bindLan';
const PROP_API_KEY = 'apiKey';

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_PORT = 8080;

/**
 * Local OpenAI-compatible API server configuration and lifecycle.
 *
 * The native side (ApiServerModule) owns the socket and the foreground
 * service; this store persists the user's choices and translates them
 * into start/stop calls. The request router lives in
 * services/localApi/serverRouter and is wired from App.tsx, keeping the
 * store free of completion logic.
 *
 * Android only: the server is a native module; on other platforms and
 * in jest the store stays stopped and the UI is hidden.
 */
export class ApiServerStore {
  /** Listening port. Persisted; clamped to [1024, 65535]. */
  port: number = DEFAULT_PORT;
  /** Bind on every interface (LAN) instead of loopback only.
   *  Requires an API key; native refuses otherwise. */
  bindLan: boolean = false;
  /** Optional bearer key. Empty means no authentication, which is only
   *  acceptable on loopback. */
  apiKey: string = '';

  /** Runtime state, not persisted. */
  running: boolean = false;
  /** "host:port" as bound, shown in the UI and notification. */
  address: string | null = null;
  lastError: string | null = null;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: STORAGE_KEY,
      properties: [PROP_PORT, PROP_BIND_LAN, PROP_API_KEY],
      storage: AsyncStorage,
    });
  }

  get available(): boolean {
    return Platform.OS === 'android';
  }

  private clampPort(p: number): number {
    if (!Number.isFinite(p)) {
      return DEFAULT_PORT;
    }
    return Math.min(Math.max(Math.floor(p), MIN_PORT), MAX_PORT);
  }

  setPort(port: number): void {
    runInAction(() => {
      this.port = this.clampPort(port);
    });
  }

  setBindLan(bindLan: boolean): void {
    runInAction(() => {
      this.bindLan = bindLan === true;
    });
  }

  setApiKey(key: string): void {
    runInAction(() => {
      this.apiKey = typeof key === 'string' ? key : '';
    });
  }

  /** Start serving with the persisted settings. Resolves with the bound
   *  address, or null when the platform has no server or startup failed
   *  (lastError carries the reason). */
  async start(): Promise<string | null> {
    if (!this.available) {
      return null;
    }
    const key = this.apiKey.trim();
    if (this.bindLan && !key) {
      runInAction(() => {
        this.lastError =
          'an API key is required to expose the server on the LAN';
      });
      return null;
    }
    try {
      const address = await NativeApiServer.start(
        this.clampPort(this.port),
        this.bindLan,
        key,
      );
      runInAction(() => {
        this.running = true;
        this.address = address;
        this.lastError = null;
      });
      return address;
    } catch (err) {
      runInAction(() => {
        this.running = false;
        this.address = null;
        this.lastError = err instanceof Error ? err.message : String(err);
      });
      return null;
    }
  }

  async stop(): Promise<void> {
    if (!this.available) {
      return;
    }
    try {
      await NativeApiServer.stop();
    } catch {
      // Stop is idempotent natively; reflect the intended state anyway.
    }
    runInAction(() => {
      this.running = false;
      this.address = null;
    });
  }
}

export const apiServerStore = new ApiServerStore();
