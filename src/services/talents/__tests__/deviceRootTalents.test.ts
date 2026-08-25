/**
 * Device-root (user-granted SAF directory) behavior for the file talents:
 * jail resolution, engine routing through SafFs, and the write gate.
 * The SafFs turbo module is the global jest mock from jest/setup.ts; tests
 * override its jest.fn implementations per case.
 */
import SafFs from '../../../specs/NativeSafFs';

import {ListFilesEngine} from '../ListFilesEngine';
import {ReadFileEngine} from '../ReadFileEngine';
import {WriteFileEngine} from '../WriteFileEngine';
import {GrepFilesEngine} from '../GrepFilesEngine';
import {
  getMountedDeviceDir,
  resolveWorkspacePath,
  setMountedDeviceDir,
} from '../workspaceFs';

const TREE =
  'content://com.android.externalstorage.documents/tree/primary%3ANotes';
const MOUNT = {treeUri: TREE, name: 'Notes', writable: false};
const MOUNT_RW = {treeUri: TREE, name: 'Notes', writable: true};

const statMock = SafFs.stat as jest.Mock;
const listDirMock = SafFs.listDir as jest.Mock;
const readFileMock = SafFs.readFile as jest.Mock;
const writeFileMock = SafFs.writeFile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  statMock.mockResolvedValue({exists: true, isDir: false, size: 0, mtime: 1});
  listDirMock.mockResolvedValue([]);
  readFileMock.mockResolvedValue('');
  writeFileMock.mockResolvedValue(undefined);
});

afterEach(() => {
  setMountedDeviceDir(null);
});

describe('two-root jail', () => {
  it('resolves device paths against the mount', () => {
    setMountedDeviceDir(MOUNT);
    const jail = resolveWorkspacePath('sub/a.md', 'device');
    expect(jail).toEqual({
      ok: true,
      kind: 'device',
      treeUri: TREE,
      rel: 'sub/a.md',
      mountName: 'Notes',
      writable: false,
    });
  });

  it('rejects device paths when nothing is mounted', () => {
    setMountedDeviceDir(null);
    const jail = resolveWorkspacePath('a.md', 'device');
    expect(jail.ok).toBe(false);
    if (!jail.ok) {
      expect(jail.reason).toMatch(/no device directory is mounted/);
    }
  });

  it('applies the same lexical rules to both roots', () => {
    setMountedDeviceDir(MOUNT);
    for (const p of ['../escape', 'a/../../escape', '/absolute/path']) {
      expect(resolveWorkspacePath(p, 'device').ok).toBe(false);
      expect(resolveWorkspacePath(p, 'workspace').ok).toBe(false);
    }
  });

  it('keeps the workspace default untouched', () => {
    setMountedDeviceDir(MOUNT);
    const jail = resolveWorkspacePath('a.md');
    expect(jail).toMatchObject({ok: true, kind: 'workspace', rel: 'a.md'});
  });
});

describe('list_files on the device root', () => {
  it('routes through SafFs.listDir', async () => {
    setMountedDeviceDir(MOUNT);
    listDirMock.mockResolvedValue([
      {name: 'b.txt', uri: 'u2', isDir: false, size: 12, mtime: 1},
      {name: 'a', uri: 'u1', isDir: true, size: 0, mtime: 1},
    ]);

    const res = await new ListFilesEngine().execute({root: 'device'});
    expect(res.type).toBe('text');
    if (res.type === 'text') {
      expect(res.summary).toContain('a/');
      expect(res.summary).toContain('b.txt');
    }
    expect(listDirMock).toHaveBeenCalledWith(TREE, '');
  });

  it('recurses via listDir on subdirectories', async () => {
    setMountedDeviceDir(MOUNT);
    listDirMock.mockImplementation(async (_tree: string, rel: string) => {
      if (rel === '') {
        return [{name: 'docs', uri: 'u1', isDir: true, size: 0, mtime: 1}];
      }
      if (rel === 'docs') {
        return [{name: 'x.md', uri: 'u2', isDir: false, size: 3, mtime: 1}];
      }
      return [];
    });

    const res = await new ListFilesEngine().execute({root: 'device'});
    expect(res.type).toBe('text');
    if (res.type === 'text') {
      expect(res.summary).toContain('docs/x.md');
    }
  });
});

describe('read_file on the device root', () => {
  it('reads through SafFs.readFile with the size cap', async () => {
    setMountedDeviceDir(MOUNT);
    statMock.mockResolvedValue({exists: true, isDir: false, size: 5, mtime: 1});
    readFileMock.mockResolvedValue('hello');

    const res = await new ReadFileEngine().execute({
      root: 'device',
      path: 'greet.txt',
    });
    expect(res.type).toBe('text');
    if (res.type === 'text') {
      expect(res.summary).toContain('hello');
    }
    expect(readFileMock).toHaveBeenCalledWith(
      TREE,
      'greet.txt',
      10 * 1024 * 1024,
    );
  });

  it('reports directories as an error', async () => {
    setMountedDeviceDir(MOUNT);
    statMock.mockResolvedValue({exists: true, isDir: true, size: 0, mtime: 1});

    const res = await new ReadFileEngine().execute({
      root: 'device',
      path: 'docs',
    });
    expect(res.type).toBe('error');
  });
});

describe('write_file on the device root', () => {
  it('refuses a read-only mount', async () => {
    setMountedDeviceDir(MOUNT);
    const res = await new WriteFileEngine().execute({
      root: 'device',
      path: 'out.txt',
      content: 'x',
    });
    expect(res.type).toBe('error');
    if (res.type === 'error') {
      expect(res.summary).toMatch(/read-only/);
      expect(res.errorMessage).toMatch(/not enabled write access/);
    }
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('writes through SafFs.writeFile on a writable mount', async () => {
    setMountedDeviceDir(MOUNT_RW);
    statMock.mockResolvedValue({exists: true, isDir: false, size: 1, mtime: 1});

    const res = await new WriteFileEngine().execute({
      root: 'device',
      path: 'out.txt',
      content: 'x',
    });
    expect(res.type).toBe('text');
    expect(writeFileMock).toHaveBeenCalledWith(TREE, 'out.txt', 'x', false);
  });

  it('passes append through', async () => {
    setMountedDeviceDir(MOUNT_RW);
    statMock.mockResolvedValue({exists: true, isDir: false, size: 1, mtime: 1});

    await new WriteFileEngine().execute({
      root: 'device',
      path: 'log.txt',
      content: 'line',
      append: true,
    });
    expect(writeFileMock).toHaveBeenCalledWith(TREE, 'log.txt', 'line', true);
  });
});

describe('grep_files on the device root', () => {
  it('walks and reads via SafFs', async () => {
    setMountedDeviceDir(MOUNT);
    listDirMock.mockResolvedValue([
      {name: 'notes.md', uri: 'u1', isDir: false, size: 20, mtime: 1},
    ]);
    readFileMock.mockResolvedValue('keep this line\nskip\nkeep also this');

    const res = await new GrepFilesEngine().execute({
      root: 'device',
      pattern: 'keep',
    });
    expect(res.type).toBe('text');
    if (res.type === 'text') {
      expect(res.summary).toContain('notes.md:1');
      expect(res.summary).toContain('notes.md:3');
    }
    expect(readFileMock).toHaveBeenCalledWith(
      TREE,
      'notes.md',
      2 * 1024 * 1024,
    );
  });
});

describe('system prompt fragments reflect the mount', () => {
  it('names the mounted directory and write state', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const ctx = {now, maxToolTurns: 5, activeTalents: new Set(['write_file'])};

    setMountedDeviceDir(MOUNT);
    const frag = new WriteFileEngine().systemPromptFragment(ctx as never);
    expect(frag).toContain('Notes');
    expect(frag).toContain('read-only');

    setMountedDeviceDir(MOUNT_RW);
    const fragRw = new WriteFileEngine().systemPromptFragment(ctx as never);
    expect(fragRw).toContain('writable');

    expect(getMountedDeviceDir()?.name).toBe('Notes');
  });
});
