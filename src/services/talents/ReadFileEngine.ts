import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  SystemPromptContext,
} from './types';
import {
  DEFAULT_READ_LINES,
  MAX_READ_CHARS,
  MAX_READ_LINES,
  MAX_READABLE_FILE_BYTES,
  looksBinary,
  resolveWorkspacePath,
  type WorkspaceRootKind,
} from './workspaceFs';
import {talentReadText, talentStat} from './talentFs';

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(max, Math.max(min, n));
}

export function parseRoot(v: unknown): WorkspaceRootKind {
  return v === 'device' ? 'device' : 'workspace';
}

export function rootArgSchema() {
  return {
    type: 'string',
    enum: ['workspace', 'device'],
    description:
      'Filesystem root: "workspace" is the app-private sandbox (default); ' +
      '"device" is the user-granted directory, when one is mounted.',
  };
}

export class ReadFileEngine implements TalentEngine {
  readonly name = 'read_file';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const root = parseRoot(args?.root);
    const jail = resolveWorkspacePath(args?.path, root);
    if (!jail.ok) {
      return {
        type: 'error',
        summary: 'read_file: invalid path',
        errorMessage: jail.reason,
      };
    }
    if (!jail.rel) {
      return {
        type: 'error',
        summary: 'read_file: path is required',
        errorMessage: 'point at a specific file; use list_files to browse',
      };
    }

    try {
      const info = await talentStat(jail);
      if (info.isDir) {
        return {
          type: 'error',
          summary: `read_file: ${jail.rel} is a directory`,
          errorMessage: 'use list_files to inspect directories',
        };
      }
      if (info.size > MAX_READABLE_FILE_BYTES) {
        return {
          type: 'error',
          summary: `read_file: ${jail.rel} is too large to read whole`,
          errorMessage:
            'file exceeds the 10 MB read cap; use grep_files to locate the relevant lines first',
        };
      }

      const content = await talentReadText(jail, MAX_READABLE_FILE_BYTES);
      if (looksBinary(content.slice(0, 4096))) {
        return {
          type: 'error',
          summary: `read_file: ${jail.rel} looks like a binary file`,
          errorMessage: 'only text files can be read',
        };
      }

      const offset = clampInt(args?.offset, 1, 1, Number.MAX_SAFE_INTEGER);
      const limit = clampInt(
        args?.limit,
        DEFAULT_READ_LINES,
        1,
        MAX_READ_LINES,
      );

      const lines = content.split('\n');
      const from = offset;
      const to = Math.min(lines.length, offset - 1 + limit);
      let body = lines.slice(from - 1, to).join('\n');
      let cut = false;
      if (body.length > MAX_READ_CHARS) {
        body = body.slice(0, MAX_READ_CHARS);
        cut = true;
      }
      const more = to < lines.length ? `, ${lines.length - to} more below` : '';
      const note = cut
        ? `\n[...truncated at ${MAX_READ_CHARS} chars; narrow with offset/limit...]`
        : '';
      return {
        type: 'text',
        summary: `${jail.rel} (lines ${from}-${to} of ${lines.length}${more}):\n${body}${note}`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `read_file: cannot read ${jail.rel}`,
        errorMessage: msg,
      };
    }
  }

  systemPromptFragment(_ctx: SystemPromptContext): string {
    return (
      'read_file(path, offset?, limit?, root?) reads a text file, paged by line ' +
      '(offset is the 1-based first line, limit caps the line count). root ' +
      'selects "workspace" (the private sandbox, default) or "device" (the ' +
      'user-granted directory, when mounted).'
    );
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Read a text file, returning numbered line ranges. Defaults to the private workspace; pass root:"device" for the user-granted directory.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'File path relative to the selected root (workspace sandbox or granted directory).',
            },
            root: rootArgSchema(),
            offset: {
              type: 'number',
              description: 'First line to return, 1-based (default: 1).',
            },
            limit: {
              type: 'number',
              description: `Maximum lines to return (default: ${DEFAULT_READ_LINES}).`,
            },
          },
          required: ['path'],
        },
      },
    };
  }
}
