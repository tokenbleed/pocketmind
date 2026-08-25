import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  SystemPromptContext,
} from './types';
import {
  MAX_WRITE_CHARS,
  getMountedDeviceDir,
  resolveWorkspacePath,
} from './workspaceFs';
import {talentWriteText} from './talentFs';
import {parseRoot, rootArgSchema} from './ReadFileEngine';

export class WriteFileEngine implements TalentEngine {
  readonly name = 'write_file';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const root = parseRoot(args?.root);
    const jail = resolveWorkspacePath(args?.path, root);
    if (!jail.ok) {
      return {
        type: 'error',
        summary: 'write_file: invalid path',
        errorMessage: jail.reason,
      };
    }
    if (!jail.rel) {
      return {
        type: 'error',
        summary: 'write_file: path is required',
        errorMessage: 'cannot write the root; name a file',
      };
    }
    if (typeof args?.content !== 'string') {
      return {
        type: 'error',
        summary: 'write_file: content must be a string',
        errorMessage: 'pass the full file content (or the text to append)',
      };
    }
    if (args.content.length > MAX_WRITE_CHARS) {
      return {
        type: 'error',
        summary: 'write_file: content too large',
        errorMessage: `content exceeds the ${MAX_WRITE_CHARS} character cap`,
      };
    }
    if (jail.kind === 'device' && !jail.writable) {
      return {
        type: 'error',
        summary: 'write_file: the device directory is mounted read-only',
        errorMessage:
          'the user has not enabled write access for the granted directory; ' +
          'ask them to enable it in Settings, or write to the workspace root',
      };
    }

    const append = args?.append === true;

    try {
      const size = await talentWriteText(jail, args.content, append);
      const sizeNote = typeof size === 'number' ? ` (now ${size} bytes)` : '';
      return {
        type: 'text',
        summary: `${append ? 'appended' : 'wrote'} ${args.content.length} chars to ${jail.rel}${sizeNote}`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `write_file: cannot write ${jail.rel}`,
        errorMessage: msg,
      };
    }
  }

  systemPromptFragment(_ctx: SystemPromptContext): string {
    const mount = getMountedDeviceDir();
    const mountNote = mount
      ? ` A device directory ("${mount.name}") is mounted as root "device" and is currently ${
          mount.writable ? 'writable' : 'read-only for write_file'
        }.`
      : '';
    return (
      'write_file(path, content, append?, root?) writes (or, with append: true, ' +
      'appends to) a text file; missing directories are created automatically. ' +
      `root selects the private workspace (default) or "device".${mountNote}`
    );
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'write_file',
        description:
          'Write or append a text file. Defaults to the private workspace; pass root:"device" for the user-granted directory (only when the user enabled write access).',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'File path relative to the selected root (workspace sandbox or granted directory).',
            },
            content: {
              type: 'string',
              description: 'Full file content, or the text to append.',
            },
            root: rootArgSchema(),
            append: {
              type: 'boolean',
              description:
                'Append to the file instead of replacing it (default: false).',
            },
          },
          required: ['path', 'content'],
        },
      },
    };
  }
}
