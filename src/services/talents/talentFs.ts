/**
 * Filesystem adapter for the talent engines: one jailed path, two possible
 * backends. The app-private sandbox goes through RNFS exactly as before;
 * a user-granted device directory goes through the SafFs turbo module
 * (Storage Access Framework). Engines never touch a backend directly, so
 * the jail in workspaceFs stays the single path authority.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';

import SafFs from '../../specs/NativeSafFs';
import type {JailResult, WorkspaceEntry} from './workspaceFs';
import {
  MAX_WALK_DEPTH,
  ensureDir,
  walkWorkspace,
  workspaceRoot,
} from './workspaceFs';

export type JailOk = Extract<JailResult, {ok: true}>;

export interface TalentFileStat {
  isDir: boolean;
  size: number;
}

export async function talentStat(jail: JailOk): Promise<TalentFileStat> {
  if (jail.kind === 'device') {
    const st = await SafFs.stat(jail.treeUri, jail.rel);
    return {isDir: st.isDir, size: st.size};
  }
  const info = await RNFS.stat(jail.abs);
  return {isDir: info.isDirectory(), size: info.size ?? 0};
}

/**
 * Read a jailed file as UTF-8 text. maxBytes is enforced by the native
 * reader on the device root (EFBIG rejection) and by the caller's size
 * check on the sandbox; passing it here too keeps one cap everywhere.
 */
export async function talentReadText(
  jail: JailOk,
  maxBytes: number,
): Promise<string> {
  if (jail.kind === 'device') {
    return SafFs.readFile(jail.treeUri, jail.rel, maxBytes);
  }
  return RNFS.readFile(jail.abs, 'utf8');
}

/**
 * Read a file by its walk-relative path under the same jail root. Used by
 * grep after walking; `rel` comes from our own walk output, never from the
 * model, so it needs no re-validation.
 */
export async function talentReadRel(
  jail: JailOk,
  rel: string,
  maxBytes: number,
): Promise<string> {
  if (jail.kind === 'device') {
    return SafFs.readFile(jail.treeUri, rel, maxBytes);
  }
  return RNFS.readFile(`${workspaceRoot()}/${rel}`, 'utf8');
}

/** Write (or append) UTF-8 text at a jailed path, creating parent
 *  directories as needed. Returns the post-write size when cheaply
 *  available, else null (the caller treats it as cosmetic). */
export async function talentWriteText(
  jail: JailOk,
  content: string,
  append: boolean,
): Promise<number | null> {
  if (jail.kind === 'device') {
    await SafFs.writeFile(jail.treeUri, jail.rel, content, append);
    try {
      const st = await SafFs.stat(jail.treeUri, jail.rel);
      return st.size;
    } catch {
      return null;
    }
  }
  const parentAbs = jail.abs.slice(0, jail.abs.lastIndexOf('/'));
  await ensureDir(parentAbs);
  if (append) {
    await RNFS.appendFile(jail.abs, content, 'utf8');
  } else {
    await RNFS.writeFile(jail.abs, content, 'utf8');
  }
  try {
    const info = await RNFS.stat(jail.abs);
    return info.size ?? null;
  } catch {
    return null;
  }
}

/**
 * Walk the jailed subtree, same semantics as walkWorkspace: directories
 * first (rel with trailing '/'), alphabetical, capped depth and entry
 * count, `truncated` set when a cap fires.
 */
export async function talentWalk(
  jail: JailOk,
  opts: {recursive: boolean; maxEntries: number},
): Promise<{entries: WorkspaceEntry[]; truncated: boolean}> {
  if (jail.kind === 'workspace') {
    return walkWorkspace(jail.abs, jail.rel, opts);
  }

  const entries: WorkspaceEntry[] = [];
  let truncated = false;

  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (entries.length >= opts.maxEntries) {
      truncated = true;
      return;
    }
    let items;
    try {
      items = await SafFs.listDir(jail.treeUri, relDir);
    } catch {
      // Unreadable directory: report nothing rather than failing the walk.
      return;
    }
    const subdirs = items.filter(i => i.isDir);
    const files = items.filter(i => !i.isDir);
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
        await walk(rel, depth + 1);
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
  };

  await walk(jail.rel, 0);
  return {entries, truncated};
}
