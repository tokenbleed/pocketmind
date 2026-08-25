/**
 * AgentFsStore: persistence-adjacent behavior (hydrate/sync, grant,
 * write toggle, revocation fallback) against the global SafFs and
 * document-picker jest mocks.
 */
import {Platform} from 'react-native';
import {pickDirectory} from '@react-native-documents/picker';

import SafFs from '../../specs/NativeSafFs';
import {getMountedDeviceDir} from '../../services/talents/workspaceFs';

const {agentFsStore} = jest.requireActual<{
  agentFsStore: import('../AgentFsStore').AgentFsStore;
}>(require.resolve('../AgentFsStore'));

const statMock = SafFs.stat as jest.Mock;
const pickDirectoryMock = pickDirectory as jest.Mock;

const TREE =
  'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2Fnotes';

let savedOS: typeof Platform.OS;

beforeAll(() => {
  savedOS = Platform.OS;
  Platform.OS = 'android';
});

afterAll(() => {
  Platform.OS = savedOS;
});

beforeEach(() => {
  jest.clearAllMocks();
  statMock.mockResolvedValue({exists: true, isDir: false, size: 0, mtime: 1});
  pickDirectoryMock.mockResolvedValue({uri: TREE});
});

afterEach(async () => {
  await agentFsStore.revokeDeviceDirectory();
});

describe('syncMount', () => {
  it('stays unmounted with no persisted grant', async () => {
    await agentFsStore.syncMount();
    expect(getMountedDeviceDir()).toBeNull();
    expect(agentFsStore.deviceGrantRevoked).toBe(false);
  });

  it('mounts a live grant with its write toggle', async () => {
    await agentFsStore.grantDeviceDirectory();
    await agentFsStore.setDeviceWritable(true);
    await agentFsStore.syncMount();

    const mount = getMountedDeviceDir();
    expect(mount).not.toBeNull();
    expect(mount?.treeUri).toBe(TREE);
    expect(mount?.writable).toBe(true);
  });

  it('falls back to unmounted when the OS revoked the grant', async () => {
    await agentFsStore.grantDeviceDirectory();
    statMock.mockRejectedValue({code: 'EACCES'});

    await agentFsStore.syncMount();
    expect(agentFsStore.deviceGrantRevoked).toBe(true);
    expect(getMountedDeviceDir()).toBeNull();
  });
});

describe('grantDeviceDirectory', () => {
  it('persists the picked tree and derives a display name', async () => {
    pickDirectoryMock.mockResolvedValue({uri: TREE});

    const name = await agentFsStore.grantDeviceDirectory();
    expect(name).toBe('notes');
    expect(agentFsStore.deviceTreeUri).toBe(TREE);
    expect(agentFsStore.deviceDirName).toBe('notes');
    expect(agentFsStore.deviceWritable).toBe(false);

    const mount = getMountedDeviceDir();
    expect(mount).toMatchObject({
      treeUri: TREE,
      name: 'notes',
      writable: false,
    });
  });

  it('resets write access on a fresh grant', async () => {
    pickDirectoryMock.mockResolvedValue({uri: TREE});
    await agentFsStore.grantDeviceDirectory();
    await agentFsStore.setDeviceWritable(true);

    const name = await agentFsStore.grantDeviceDirectory();
    expect(name).toBe('notes');
    expect(agentFsStore.deviceWritable).toBe(false);
  });

  it('returns null on cancellation and keeps prior state', async () => {
    pickDirectoryMock.mockResolvedValue(undefined);
    const name = await agentFsStore.grantDeviceDirectory();
    expect(name).toBeNull();
    expect(agentFsStore.deviceTreeUri).toBeNull();
  });
});

describe('write toggle and revoke', () => {
  it('toggles mount writability', async () => {
    pickDirectoryMock.mockResolvedValue({uri: TREE});
    await agentFsStore.grantDeviceDirectory();

    await agentFsStore.setDeviceWritable(true);
    expect(getMountedDeviceDir()?.writable).toBe(true);

    await agentFsStore.setDeviceWritable(false);
    expect(getMountedDeviceDir()?.writable).toBe(false);
  });

  it('clears everything on revoke', async () => {
    pickDirectoryMock.mockResolvedValue({uri: TREE});
    await agentFsStore.grantDeviceDirectory();

    await agentFsStore.revokeDeviceDirectory();
    expect(agentFsStore.deviceTreeUri).toBeNull();
    expect(agentFsStore.deviceDirName).toBeNull();
    expect(agentFsStore.deviceWritable).toBe(false);
    expect(getMountedDeviceDir()).toBeNull();
  });
});
