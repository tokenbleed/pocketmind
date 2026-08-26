import * as RNFS from '@dr.pogodin/react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {action, computed, makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import {stopRpcServer, startRpcServer} from 'llama.rn';

/**
 * Multi-phone pooled compute state.
 *
 * Two independent roles:
 *
 * - HOST: the phone that runs the model. `hostEndpoints` lists worker
 *   "ip:port" endpoints; ModelStore passes them as `rpc_servers` on context
 *   init and llama.cpp splits tensors across local + worker devices.
 *
 * - WORKER: a phone that lends its RAM/compute. `startWorker()` runs an
 *   in-app llama.cpp RPC server (plain TCP on the LAN, no auth: only ever
 *   enable it on a network you trust, ideally a phone-to-phone hotspot).
 */

const DEFAULT_WORKER_PORT = 50052;

export class PoolStore {
  /** Worker "ip:port" endpoints, one per line or comma-separated. */
  hostEndpoints = '';

  /** Port the local worker server binds to. */
  workerPort = DEFAULT_WORKER_PORT;

  /** CPU threads for the local worker (0 = half of hardware threads). */
  workerThreads = 0;

  /** True while the local RPC server thread is listening. */
  workerActive = false;

  /** Last worker start/stop error, if any. */
  workerError: string | null = null;

  constructor() {
    makeAutoObservable(this, {
      rpcServers: computed,
      setHostEndpoints: action,
      setWorkerPort: action,
      setWorkerThreads: action,
    });
    makePersistable(this, {
      name: 'pocketmind.pool',
      properties: ['hostEndpoints', 'workerPort', 'workerThreads'],
      storage: AsyncStorage,
    });
  }

  /** Parsed, validated endpoint list for `rpc_servers` on context init. */
  @computed
  get rpcServers(): string[] {
    return this.hostEndpoints
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(e));
  }

  setHostEndpoints(value: string) {
    this.hostEndpoints = value;
  }

  setWorkerPort(value: number) {
    this.workerPort = value;
  }

  setWorkerThreads(value: number) {
    this.workerThreads = value;
  }

  /** Start the local worker RPC server (idempotent). */
  startWorker = async () => {
    if (this.workerActive) {
      return;
    }
    try {
      const cacheDir = `${RNFS.DocumentDirectoryPath}/rpc-cache`;
      if (!(await RNFS.exists(cacheDir))) {
        await RNFS.mkdir(cacheDir);
      }
      await startRpcServer({
        host: '0.0.0.0',
        port: this.workerPort,
        n_threads: this.workerThreads,
        cache_dir: cacheDir,
      });
      runInAction(() => {
        this.workerActive = true;
        this.workerError = null;
      });
    } catch (e) {
      runInAction(() => {
        this.workerActive = false;
        this.workerError = e instanceof Error ? e.message : String(e);
      });
    }
  };

  /** Stop the local worker RPC server (idempotent). */
  stopWorker = async () => {
    try {
      await stopRpcServer();
    } catch {
      // Stopping a server that never started is not an error for the user.
    } finally {
      runInAction(() => {
        this.workerActive = false;
      });
    }
  };
}

export const poolStore = new PoolStore();
