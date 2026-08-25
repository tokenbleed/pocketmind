import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * Lexical path jail for the agent workspace talents.
 *
 * The workspace is a single private directory under the app's document
 * storage. Every workspace tool resolves user/model-supplied paths through
 * resolveWorkspacePath() before touching the filesystem; the resolution is
 * purely lexical (segment-wise, no symlink chasing), so no input can name
 * anything outside the workspace root:
 *   - absolute paths outside the root are rejected outright
 *   - an absolute path that IS the root (or under it) is stripped to its
 *     relative part, so a model that echoes a path from a previous result
 *     still works
 *   - '.', empty segments, and duplicate slashes are dropped
 *   - '..' is rejected - there is never a legitimate parent escape from a
 *     single-rooted scratch directory
 *   - NUL bytes and drive-letter prefixes are rejected defensively
 */
export const WORKSPACE_DIR_NAME = 'workspace';

/** Which filesystem root a talent path resolves against. 'workspace' is
 *  the app-private sandbox (default, always present); 'device' is a
 *  user-granted directory via the system picker, present only while a
 *  persisted SAF grant is mounted (see AgentFsStore). */
export type WorkspaceRootKind = 'workspace' | 'device';

export interface MountedDeviceDir {
  /** Persisted SAF tree URI (content://...). */
  treeUri: string;
  /** Human-readable directory name for prompts and settings. */
  name: string;
  /** Whether write_file may target this root. Read-only by default. */
  writable: boolean;
}

/** Module-level mount state, synced from AgentFsStore. Read by the jail
 *  and by system-prompt fragments at message-assembly time; the engines
 *  stay free of store imports (same pattern as readUrlAllowlist). */
let mountedDeviceDir: MountedDeviceDir | null = null;

export function setMountedDeviceDir(mount: MountedDeviceDir | null): void {
  mountedDeviceDir = mount;
}

export function getMountedDeviceDir(): MountedDeviceDir | null {
  return mountedDeviceDir;
}

export function workspaceRoot(): string {
  return `${RNFS.DocumentDirectoryPath}/${WORKSPACE_DIR_NAME}`;
}

export type JailResult =
  | {ok: true; kind: 'workspace'; abs: string; rel: string}
  | {
      ok: true;
      kind: 'device';
      treeUri: string;
      rel: string;
      mountName: string;
      writable: boolean;
    }
  | {ok: false; reason: string};

/** Shared lexical rules for both roots: normalize separators, reject NUL /
 *  drive letters / '..' / oversized segments, and collect clean segments.
 *  Returns null with `reason` set when the input cannot be jailed. */
function jailSegments(
  p: string,
  rootKind: WorkspaceRootKind,
): {segments: string[]} | {reason: string} {
  if (p.includes('\0')) {
    return {reason: 'path contains a NUL byte'};
  }
  p = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(p)) {
    return {reason: 'drive-letter paths are not allowed'};
  }

  // Tolerate the model echoing the sandbox's absolute path back at us.
  if (rootKind === 'workspace') {
    const root = workspaceRoot();
    if (p === root) {
      p = '';
    } else if (p.startsWith(`${root}/`)) {
      p = p.slice(root.length + 1);
    }
  }

  // A bare '/' is the jail's own root as far as the model is concerned.
  if (p === '/') {
    p = '';
  }
  if (p.startsWith('/')) {
    return {
      reason: `absolute paths outside the ${rootKind === 'device' ? 'granted directory' : 'workspace'} are not allowed`,
    };
  }

  const segments: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      return {
        reason: `".." is not allowed; paths are confined to the ${rootKind === 'device' ? 'granted directory' : 'workspace'}`,
      };
    }
    if (seg.length > 255) {
      return {
        reason: `path segment too long: ${seg.slice(0, 32)}...`,
      };
    }
    segments.push(seg);
  }

  const rel = segments.join('/');
  if (rel.length > 1024) {
    return {reason: 'path too long'};
  }
  return {segments};
}

export function resolveWorkspacePath(
  input: unknown,
  rootKind: WorkspaceRootKind = 'workspace',
): JailResult {
  // Absent path means the root; everything else must be a string.
  let p: string;
  if (input === undefined || input === null) {
    p = '';
  } else if (typeof input !== 'string') {
    return {ok: false, reason: 'path must be a string'};
  } else {
    p = input.trim();
  }

  const jailed = jailSegments(p, rootKind);
  if ('reason' in jailed) {
    return {ok: false, reason: jailed.reason};
  }
  const rel = jailed.segments.join('/');

  if (rootKind === 'device') {
    const mount = mountedDeviceDir;
    if (!mount) {
      return {
        ok: false,
        reason:
          'no device directory is mounted; ask the user to grant one in Settings, or use the workspace root',
      };
    }
    return {
      ok: true,
      kind: 'device',
      treeUri: mount.treeUri,
      rel,
      mountName: mount.name,
      writable: mount.writable,
    };
  }

  const root = workspaceRoot();
  return {ok: true, kind: 'workspace', abs: rel ? `${root}/${rel}` : root, rel};
}

/** mkdir -p, tolerant of the directory already existing. */
export async function ensureDir(absPath: string): Promise<void> {
  try {
    // @dr.pogodin/react-native-fs mkdir() creates intermediate directories
    // by default; its options object only carries iOS backup/protection keys.
    await RNFS.mkdir(absPath);
  } catch (e) {
    // Most builds only throw for genuine failures, but some Android versions
    // surface EEXIST for an existing directory - treat that as done.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/exist/i.test(msg)) {
      throw e;
    }
  }
}

/** Create the workspace root if missing. Safe to call repeatedly. */
export async function ensureWorkspace(): Promise<void> {
  await ensureDir(workspaceRoot());
}

export const MAX_READ_CHARS = 20000;
export const DEFAULT_READ_LINES = 400;
export const MAX_READ_LINES = 2000;
export const MAX_READABLE_FILE_BYTES = 10 * 1024 * 1024;

export const MAX_WRITE_CHARS = 256 * 1024;

export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 400;
export const MAX_WALK_DEPTH = 8;

export const DEFAULT_GREP_MATCHES = 50;
export const MAX_GREP_MATCHES = 200;
export const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_GREP_FILES = 500;
export const GREP_LINE_CHARS = 240;

export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface WorkspaceEntry {
  rel: string;
  isDir: boolean;
  size: number;
}

/**
 * Depth-first walk of the workspace subtree at `absStart` (already jailed),
 * collecting entries as workspace-relative paths. Caps walk depth and total
 * entries; sets `truncated` when either cap fires.
 */
export async function walkWorkspace(
  absStart: string,
  relStart: string,
  opts: {recursive: boolean; maxEntries: number},
): Promise<{entries: WorkspaceEntry[]; truncated: boolean}> {
  const entries: WorkspaceEntry[] = [];
  let truncated = false;

  async function walk(absDir: string, relDir: string, depth: number) {
    if (entries.length >= opts.maxEntries) {
      truncated = true;
      return;
    }
    let items: RNFS.ReadDirResItemT[];
    try {
      items = await RNFS.readDir(absDir);
    } catch {
      // Unreadable directory: report nothing rather than failing the walk.
      return;
    }
    // Dirs first, then files, each alphabetical - stable, greppable output.
    const subdirs: RNFS.ReadDirResItemT[] = [];
    const files: RNFS.ReadDirResItemT[] = [];
    for (const it of items) {
      (it.isDirectory() ? subdirs : files).push(it);
    }
    subdirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    for (const it of subdirs) {
      if (entries.length >= opts.maxEntries) {
        truncated = true;
        return;
      }
      const rel = relDir ? `${relDir}/${it.name}` : it.name;
      entries.push({rel: `${rel}/`, isDir: true, size: 0});
      if (opts.recursive && depth < MAX_WALK_DEPTH) {
        await walk(it.path, rel, depth + 1);
      }
    }
    for (const it of files) {
      if (entries.length >= opts.maxEntries) {
        truncated = true;
        return;
      }
      const rel = relDir ? `${relDir}/${it.name}` : it.name;
      entries.push({rel, isDir: false, size: it.size ?? 0});
    }
  }

  await walk(absStart, relStart, 0);
  return {entries, truncated};
}

/** True when the buffer looks binary (NUL in the prefix) - grep skips these. */
export function looksBinary(prefix: string): boolean {
  return prefix.includes('\0');
}

// --- Workspace browser (screen) helpers ---------------------------------
// These sit on top of the same jail the talents use, but return richer
// entries (absolute path, mtime) for the Workspace screen listing.

export interface WorkspaceFileEntry {
  relPath: string;
  absPath: string;
  size: number;
  mtime: number | null;
}

const MAX_BROWSER_ENTRIES = 1000;

export async function listWorkspaceFiles(): Promise<WorkspaceFileEntry[]> {
  await ensureWorkspace();
  const root = workspaceRoot();
  const out: WorkspaceFileEntry[] = [];

  async function walk(absDir: string, relDir: string, depth: number) {
    if (depth > MAX_WALK_DEPTH || out.length >= MAX_BROWSER_ENTRIES) {
      return;
    }
    let items;
    try {
      items = await RNFS.readDir(absDir);
    } catch {
      return; // unreadable subtree: skip, do not fail the listing
    }
    for (const it of items) {
      if (out.length >= MAX_BROWSER_ENTRIES) {
        return;
      }
      if (it.isDirectory()) {
        await walk(
          it.path,
          relDir ? `${relDir}/${it.name}` : it.name,
          depth + 1,
        );
      } else {
        out.push({
          relPath: relDir ? `${relDir}/${it.name}` : it.name,
          absPath: it.path,
          size: it.size ?? 0,
          mtime: it.mtime instanceof Date ? it.mtime.getTime() : null,
        });
      }
    }
  }

  await walk(root, '', 0);
  // Newest first: what the model touched last is what you look for.
  out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  return out;
}

/** Read a workspace file as text for preview. Throws when the file is
 * binary or oversized; the screen maps that to a "not text" notice. */
export async function readWorkspaceText(
  absPath: string,
  maxChars: number,
): Promise<string> {
  const stat = await RNFS.stat(absPath);
  if ((stat.size ?? 0) > MAX_READABLE_FILE_BYTES) {
    throw new Error('file too large to preview');
  }
  const content = await RNFS.readFile(absPath, 'utf8');
  if (looksBinary(content.slice(0, 4096))) {
    throw new Error('binary file');
  }
  return content.length > maxChars ? content.slice(0, maxChars) : content;
}

/** Delete one workspace file (not directories). Tolerates a missing
 * file so a double-tap on a stale listing does not error. */
export async function deleteWorkspaceFile(absPath: string): Promise<void> {
  try {
    await RNFS.unlink(absPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/exist|no such/i.test(msg)) {
      throw e;
    }
  }
}
