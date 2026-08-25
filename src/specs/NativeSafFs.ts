import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Storage Access Bridge: bounded file operations inside a directory the
 * user granted via the system directory picker (SAF tree URI).
 *
 * Every method resolves `relPath` segment-by-segment under the tree root
 * using DocumentFile.findFile, so '..' segments, absolute paths, and any
 * attempt to walk out of the granted tree fail natively even if the JS-side
 * lexical jail were bypassed. Sizes are in bytes.
 */
export interface SafEntry {
  /** Display name of the entry. */
  name: string;
  /** Full content:// document URI for this entry. */
  uri: string;
  isDir: boolean;
  size: number;
  /** Millis since epoch, or null when the provider reports none. */
  mtime: number | null;
}

export interface SafStat {
  exists: boolean;
  isDir: boolean;
  size: number;
  mtime: number | null;
}

export interface Spec extends TurboModule {
  /** Resolve a relative path under the tree. Returns exists:false rather
   *  than rejecting when the path is missing. Rejects EACCES when the
   *  persisted grant has been revoked. */
  stat(treeUri: string, relPath: string): Promise<SafStat>;
  /** List one directory level, entries alphabetical by name.
   *  Rejects ENOENT/EISDIR-style errors when the path is missing or is
   *  a file. */
  listDir(treeUri: string, relPath: string): Promise<SafEntry[]>;
  /** Read up to maxBytes bytes and return them as UTF-8 text (invalid
   *  bytes become replacement characters, same as every other text read
   *  in the app). Rejects EFBIG when the file exceeds maxBytes. */
  readFile(treeUri: string, relPath: string, maxBytes: number): Promise<string>;
  /** Write (or append) UTF-8 text, creating missing parent directories.
   *  Rejects EACCES when the grant is read-only or revoked. */
  writeFile(
    treeUri: string,
    relPath: string,
    content: string,
    append: boolean,
  ): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SafFs');
