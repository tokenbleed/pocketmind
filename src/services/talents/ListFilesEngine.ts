import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  SystemPromptContext,
} from './types';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  formatBytes,
  getMountedDeviceDir,
  resolveWorkspacePath,
  ensureWorkspace,
} from './workspaceFs';
import {talentWalk} from './talentFs';
import {parseRoot, rootArgSchema} from './ReadFileEngine';

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(max, Math.max(min, n));
}

export class ListFilesEngine implements TalentEngine {
  readonly name = 'list_files';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const root = parseRoot(args?.root);
    const jail = resolveWorkspacePath(args?.path, root);
    if (!jail.ok) {
      return {
        type: 'error',
        summary: 'list_files: invalid path',
        errorMessage: jail.reason,
      };
    }
    const recursive = args?.recursive !== false;
    const limit = clampInt(args?.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);

    if (jail.kind === 'workspace') {
      await ensureWorkspace();
    }

    let entries;
    let truncated;
    try {
      const walked = await talentWalk(jail, {
        recursive,
        maxEntries: limit,
      });
      ({entries, truncated} = walked);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `list_files: failed to read ${jail.rel || 'workspace'}`,
        errorMessage: msg,
      };
    }

    if (entries.length === 0) {
      const mount = getMountedDeviceDir();
      const summary =
        jail.kind === 'device'
          ? `the granted directory${mount ? ` (${mount.name})` : ''} is empty or unreadable`
          : 'workspace is empty (no files yet). write_file creates files; ' +
            'paths are relative to the workspace root.';
      return {type: 'text', summary};
    }

    const lines = entries.map(e =>
      e.isDir
        ? `dir   ${e.rel}`
        : `file  ${formatBytes(e.size).padStart(9)}  ${e.rel}`,
    );
    const note = truncated
      ? `\n(list truncated at ${limit} entries; pass a narrower path or a smaller limit)`
      : '';
    const fileCount = entries.filter(e => !e.isDir).length;
    const label =
      jail.kind === 'device'
        ? `device:${jail.rel || getMountedDeviceDir()?.name || 'device'}`
        : jail.rel || 'workspace';
    return {
      type: 'text',
      summary: `${label} - ${fileCount} file(s):\n${lines.join('\n')}${note}`,
    };
  }

  systemPromptFragment(_ctx: SystemPromptContext): string {
    const mount = getMountedDeviceDir();
    const mountNote = mount
      ? ` The user has granted access to a device directory "${mount.name}" ` +
        `(root "device"); its files are readable with list_files/read_file/grep_files` +
        `${mount.writable ? ' and writable with write_file' : ' but read-only'}.`
      : '';
    return (
      'File workspace: list_files(path?, recursive?, limit?, root?) lists files, ' +
      "defaulting to the app's private workspace directory. All workspace tools use " +
      'paths relative to their root and cannot access anything outside it.' +
      mountNote
    );
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'list_files',
        description:
          'List files. Defaults to the private workspace; pass root:"device" for the user-granted directory. Directories are shown with a trailing slash.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Subdirectory to list, relative to the selected root (default: the root).',
            },
            root: rootArgSchema(),
            recursive: {
              type: 'boolean',
              description: 'Recurse into subdirectories (default: true).',
            },
            limit: {
              type: 'number',
              description:
                'Maximum entries to return (default: 200, max: 400).',
            },
          },
        },
      },
    };
  }
}
