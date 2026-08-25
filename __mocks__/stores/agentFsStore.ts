import {makeAutoObservable} from 'mobx';

/**
 * Test double for AgentFsStore: plain in-memory fields, async methods as
 * jest.fn resolving immediately. Tests drive state directly.
 */
class MockAgentFsStore {
  deviceTreeUri: string | null = null;
  deviceDirName: string | null = null;
  deviceWritable: boolean = false;
  deviceGrantRevoked: boolean = false;

  syncMount: jest.Mock;
  grantDeviceDirectory: jest.Mock;
  setDeviceWritable: jest.Mock;
  revokeDeviceDirectory: jest.Mock;

  constructor() {
    makeAutoObservable(this, {
      syncMount: false,
      grantDeviceDirectory: false,
      setDeviceWritable: false,
      revokeDeviceDirectory: false,
    });

    this.syncMount = jest.fn(() => Promise.resolve());
    this.grantDeviceDirectory = jest.fn(() => Promise.resolve('Notes'));
    this.setDeviceWritable = jest.fn(() => Promise.resolve());
    this.revokeDeviceDirectory = jest.fn(() => Promise.resolve());
  }
}

export const mockAgentFsStore = new MockAgentFsStore();
