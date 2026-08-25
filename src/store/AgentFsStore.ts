import AsyncStorage from '@react-native-async-storage/async-storage';
import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import {Platform} from 'react-native';
import {pickDirectory} from '@react-native-documents/picker';

import SafFs from '../specs/NativeSafFs';
import {setMountedDeviceDir} from '../services/talents/workspaceFs';

const STORAGE_KEY = 'AgentFsStore.v1';
const PROP_TREE_URI = 'deviceTreeUri';
const PROP_NAME = 'deviceDirName';
const PROP_WRITABLE = 'deviceWritable';

/**
 * User-granted device directory for agent file access (Storage Access
 * Framework tree URI). The persisted URI/name/write-toggle live here; the
 * talent jail consumes them through `setMountedDeviceDir`, so engines and
 * system-prompt fragments stay free of store imports.
 *
 * Android only: the picker grant is a SAF takePersistableUriPermission.
 * On other platforms the store stays empty and the UI is hidden.
 */
export class AgentFsStore {
  /** Persisted SAF tree URI, or null when no directory is granted. */
  deviceTreeUri: string | null = null;
  /** Last known display name of the granted directory (prompts/UI). */
  deviceDirName: string | null = null;
  /** Whether write_file may target the device root. Read-only by default. */
  deviceWritable: boolean = false;

  /** Set when the persisted grant no longer resolves (user revoked it in
   *  system settings); surfaced by the UI to prompt a re-grant. */
  deviceGrantRevoked: boolean = false;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: STORAGE_KEY,
      properties: [PROP_TREE_URI, PROP_NAME, PROP_WRITABLE],
      storage: AsyncStorage,
    }).then(() => this.syncMount());
  }

  /** Push persisted state into the talent jail. Called after hydration and
   *  after every change; verifies the grant is still live, falling back to
   *  an unmounted state when the OS revoked it. */
  async syncMount(): Promise<void> {
    const uri =
      typeof this.deviceTreeUri === 'string' ? this.deviceTreeUri : null;
    const name =
      typeof this.deviceDirName === 'string' ? this.deviceDirName : null;
    if (!uri || !name) {
      runInAction(() => {
        this.deviceGrantRevoked = false;
      });
      setMountedDeviceDir(null);
      return;
    }
    if (Platform.OS !== 'android') {
      // A grant picked up on Android would be meaningless elsewhere; also
      // covers jest runs where the native module is absent.
      setMountedDeviceDir(null);
      return;
    }
    try {
      // Any successful stat proves the grant still resolves. Rejections
      // with EACCES mean revoked; anything else is treated as revoked too -
      // failing closed keeps the agent inside the sandbox.
      await SafFs.stat(uri, '');
      runInAction(() => {
        this.deviceGrantRevoked = false;
      });
      setMountedDeviceDir({
        treeUri: uri,
        name,
        writable: this.deviceWritable === true,
      });
    } catch {
      runInAction(() => {
        this.deviceGrantRevoked = true;
      });
      setMountedDeviceDir(null);
    }
  }

  /** Open the system directory picker and persist the grant. Returns the
   *  display name on success, null when the user cancelled. Throws when
   *  the picker itself fails. */
  async grantDeviceDirectory(): Promise<string | null> {
    const res = await pickDirectory({requestLongTermAccess: true});
    // User cancelled: Android returns undefined on ACTION_CANCEL.
    if (!res || !res.uri) {
      return null;
    }
    // Tree URIs look like content://.../tree/primary%3ADocuments%2Fnotes;
    // the trailing document-id segment is the best human label we have JS-side.
    let name = '';
    try {
      const docId = decodeURIComponent(res.uri.split('tree/')[1] ?? '');
      const tail = docId.split(':').pop() ?? '';
      name = tail.split('/').filter(Boolean).pop() ?? '';
    } catch {
      name = '';
    }
    const displayName = name.replace(/[/\\:]/g, '').trim() || 'Device folder';
    runInAction(() => {
      this.deviceTreeUri = res.uri;
      this.deviceDirName = displayName;
      // A fresh grant always starts read-only; the user opts into writes.
      this.deviceWritable = false;
      this.deviceGrantRevoked = false;
    });
    await this.syncMount();
    return displayName;
  }

  /** Toggle write access for the device root (kept off by default). */
  async setDeviceWritable(writable: boolean): Promise<void> {
    runInAction(() => {
      this.deviceWritable = writable === true;
    });
    await this.syncMount();
  }

  /** Drop the grant entirely. */
  async revokeDeviceDirectory(): Promise<void> {
    runInAction(() => {
      this.deviceTreeUri = null;
      this.deviceDirName = null;
      this.deviceWritable = false;
      this.deviceGrantRevoked = false;
    });
    setMountedDeviceDir(null);
  }
}

export const agentFsStore = new AgentFsStore();
