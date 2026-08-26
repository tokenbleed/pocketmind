import * as RNFS from '@dr.pogodin/react-native-fs';

// Mock persistence BEFORE importing the store
jest.mock('mobx-persist-store', () => ({
  makePersistable: jest.fn().mockReturnValue(Promise.resolve()),
}));

import {startRpcServer, stopRpcServer} from 'llama.rn';

import {PoolStore} from '../PoolStore';

describe('PoolStore', () => {
  let store: PoolStore;

  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockImplementation(async () => false);
    (RNFS.mkdir as jest.Mock).mockImplementation(async () => undefined);
    store = new PoolStore();
  });

  describe('rpcServers', () => {
    it('parses newline- and comma-separated ip:port entries', () => {
      store.setHostEndpoints(
        '192.168.1.5:50052\n10.0.0.3:60000, 192.168.43.7:50052',
      );
      expect(store.rpcServers).toEqual([
        '192.168.1.5:50052',
        '10.0.0.3:60000',
        '192.168.43.7:50052',
      ]);
    });

    it('drops malformed entries', () => {
      store.setHostEndpoints('not-an-endpoint\n192.168.1.5\n:50052\n ok');
      expect(store.rpcServers).toEqual([]);
    });

    it('is empty when unset', () => {
      expect(store.rpcServers).toEqual([]);
    });
  });

  describe('startWorker', () => {
    it('creates the cache dir and starts the RPC server', async () => {
      await store.startWorker();
      expect(RNFS.mkdir as jest.Mock).toHaveBeenCalledWith(
        `${RNFS.DocumentDirectoryPath}/rpc-cache`,
      );
      expect(startRpcServer).toHaveBeenCalledWith({
        host: '0.0.0.0',
        port: 50052,
        n_threads: 0,
        cache_dir: `${RNFS.DocumentDirectoryPath}/rpc-cache`,
      });
      expect(store.workerActive).toBe(true);
      expect(store.workerError).toBeNull();
    });

    it('skips mkdir when the cache dir exists', async () => {
      (RNFS.exists as jest.Mock).mockImplementation(async () => true);
      await store.startWorker();
      expect(RNFS.mkdir as jest.Mock).not.toHaveBeenCalled();
    });

    it('records the error when the server fails to start', async () => {
      (startRpcServer as jest.Mock).mockRejectedValueOnce(
        new Error('bind failed'),
      );
      await store.startWorker();
      expect(store.workerActive).toBe(false);
      expect(store.workerError).toBe('bind failed');
    });

    it('is idempotent while active', async () => {
      await store.startWorker();
      await store.startWorker();
      expect(startRpcServer).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopWorker', () => {
    it('stops an active worker', async () => {
      await store.startWorker();
      await store.stopWorker();
      expect(stopRpcServer).toHaveBeenCalled();
      expect(store.workerActive).toBe(false);
    });

    it('is safe when no worker is running', async () => {
      await store.stopWorker();
      expect(store.workerActive).toBe(false);
    });

    it('clears the active flag even when stop throws', async () => {
      await store.startWorker();
      (stopRpcServer as jest.Mock).mockRejectedValueOnce(
        new Error('not started'),
      );
      await store.stopWorker();
      expect(store.workerActive).toBe(false);
    });
  });
});
