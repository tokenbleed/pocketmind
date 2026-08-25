/**
 * Local API server router: request handling for /v1/models and
 * /v1/chat/completions against the (mocked) model store, driven through
 * the same device-event path production uses.
 */
import {DeviceEventEmitter} from 'react-native';

import {modelStore} from '../../../store';
import {
  ensureApiServerRouter,
  resetApiServerRouter,
  type Responder,
} from '../serverRouter';

const MODEL = {
  id: 'model-123',
  name: 'Test Model Q4',
  params: 3,
  isDownloaded: true,
  origin: 'LOCAL',
};

function fakeContext(impl?: (params: any, cb?: any) => Promise<any>) {
  return {
    completion:
      impl ??
      jest.fn(async (_params: any, cb?: any) => {
        cb?.({token: 'Hel'});
        cb?.({token: 'lo'});
        return {
          text: 'Hello',
          content: 'Hello',
          tokens_predicted: 2,
          tokens_evaluated: 3,
        };
      }),
    stopCompletion: jest.fn(async () => {}),
  };
}

function makeResponder(): Responder & {
  respond: jest.Mock;
  respondStreamChunk: jest.Mock;
  respondStreamEnd: jest.Mock;
  respondStreamFail: jest.Mock;
} {
  return {
    respond: jest.fn(),
    respondStreamChunk: jest.fn(),
    respondStreamEnd: jest.fn(),
    respondStreamFail: jest.fn(),
  };
}

function emit(evt: {id: string; method: string; path: string; body?: string}) {
  DeviceEventEmitter.emit('apiServerRequest', {body: '', ...evt});
}

beforeEach(() => {
  resetApiServerRouter();
  modelStore.models = [{...MODEL}] as any;
  modelStore.activeModelId = MODEL.id;
  modelStore.lastUsedModelId = MODEL.id;
  modelStore.context = fakeContext() as any;
});

afterEach(() => {
  resetApiServerRouter();
});

describe('GET /v1/models', () => {
  it('lists the loaded model under its friendly name', () => {
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({id: '1', method: 'GET', path: '/v1/models'});
    expect(r.respond).toHaveBeenCalledWith(
      '1',
      200,
      expect.stringContaining('"id":"Test Model Q4"'),
    );
    const payload = JSON.parse(r.respond.mock.calls[0][2]);
    expect(payload.object).toBe('list');
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].owned_by).toBe('local');
  });

  it('returns an empty list when no context is loaded', () => {
    modelStore.context = undefined;
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({id: '2', method: 'GET', path: '/v1/models'});
    expect(JSON.parse(r.respond.mock.calls[0][2]).data).toEqual([]);
  });
});

describe('POST /v1/chat/completions', () => {
  const body = JSON.stringify({
    model: 'Test Model Q4',
    messages: [{role: 'user', content: 'hi'}],
  });

  it('answers non-stream requests with a chat.completion payload', async () => {
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({id: '3', method: 'POST', path: '/v1/chat/completions', body});
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(r.respond).toHaveBeenCalledTimes(1);
    const [id, status, json] = r.respond.mock.calls[0];
    expect(id).toBe('3');
    expect(status).toBe(200);
    const payload = JSON.parse(json);
    expect(payload.object).toBe('chat.completion');
    expect(payload.choices[0].message.content).toBe('Hello');
    expect(payload.choices[0].finish_reason).toBe('stop');
    expect(payload.usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
    });
  });

  it('streams role chunk, token chunks, finish, and [DONE]', async () => {
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '4',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'Test Model Q4',
        messages: [{role: 'user', content: 'hi'}],
        stream: true,
      }),
    });
    // Let the async handler run to completion.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    const chunks = r.respondStreamChunk.mock.calls.map(c => c[1]);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    const first = JSON.parse(chunks[0].slice(6));
    expect(first.choices[0].delta).toEqual({role: 'assistant', content: ''});
    const tokenChunks = chunks
      .slice(1, -2)
      .map((c: string) => JSON.parse(c.slice(6)));
    expect(
      tokenChunks.map((c: any) => c.choices[0].delta.content).join(''),
    ).toBe('Hello');
    const finish = JSON.parse(chunks[chunks.length - 2].slice(6));
    expect(finish.choices[0].finish_reason).toBe('stop');
    expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
    expect(r.respondStreamEnd).toHaveBeenCalledWith('4');
    expect(r.respond).not.toHaveBeenCalled();
  });

  it('passes reasoning deltas through as reasoning_content', async () => {
    modelStore.context = fakeContext(
      jest.fn(async (_p: any, cb?: any) => {
        cb?.({reasoning_content: 'thinking...'});
        cb?.({token: 'ok'});
        return {
          text: 'ok',
          content: 'ok',
          tokens_predicted: 1,
          tokens_evaluated: 1,
        };
      }),
    ) as any;
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '5',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        messages: [{role: 'user', content: 'hi'}],
        stream: true,
      }),
    });
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    const raw = r.respondStreamChunk.mock.calls
      .map(c => c[1])
      .filter(c => c.startsWith('data: {'))
      .map(c => JSON.parse(c.slice(6)));
    const deltas = raw.map((c: any) => c.choices[0].delta);
    expect(deltas).toContainEqual({reasoning_content: 'thinking...'});
    expect(deltas).toContainEqual({content: 'ok'});
  });

  it('rejects a model that is not the loaded one with a 404 hint', async () => {
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '6',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'other-model',
        messages: [{role: 'user', content: 'hi'}],
      }),
    });
    await Promise.resolve();
    const [id, status, json] = r.respond.mock.calls[0];
    expect(id).toBe('6');
    expect(status).toBe(404);
    expect(JSON.parse(json).error.message).toContain('Test Model Q4');
  });

  it('reports 503 when no local model is loaded', async () => {
    modelStore.context = undefined;
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({id: '7', method: 'POST', path: '/v1/chat/completions', body});
    await Promise.resolve();
    expect(r.respond.mock.calls[0][1]).toBe(503);
  });

  it('reports 400 for invalid JSON', async () => {
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '8',
      method: 'POST',
      path: '/v1/chat/completions',
      body: '{nope',
    });
    await Promise.resolve();
    expect(r.respond.mock.calls[0][1]).toBe(400);
  });

  it('reports 400 for unsupported message roles', async () => {
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '9',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        messages: [{role: 'tool', content: 'x'}],
      }),
    });
    await Promise.resolve();
    const json = JSON.parse(r.respond.mock.calls[0][2]);
    expect(r.respond.mock.calls[0][1]).toBe(400);
    expect(json.error.message).toContain('unsupported role');
  });

  it('flattens content parts arrays into text', async () => {
    const ctx = fakeContext();
    modelStore.context = ctx as any;
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '10',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              {type: 'text', text: 'part one '},
              {type: 'text', text: 'part two'},
            ],
          },
        ],
      }),
    });
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(r.respond.mock.calls[0][1]).toBe(200);
    const sent = (ctx.completion as jest.Mock).mock.calls[0][0];
    expect(sent.messages[0].content).toBe('part one part two');
  });

  it('replies 429 while another completion is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    modelStore.context = fakeContext(
      jest.fn(async () => {
        await gate;
        return {
          text: 'a',
          content: 'a',
          tokens_predicted: 1,
          tokens_evaluated: 1,
        };
      }),
    ) as any;
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '11',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({messages: [{role: 'user', content: 'first'}]}),
    });
    await Promise.resolve();
    emit({
      id: '12',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({messages: [{role: 'user', content: 'second'}]}),
    });
    await Promise.resolve();
    expect(r.respond.mock.calls[0]).toEqual([
      '12',
      429,
      expect.stringContaining('already running'),
    ]);
    release();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(r.respond.mock.calls.some(c => c[0] === '11' && c[1] === 200)).toBe(
      true,
    );
  });

  it('maps a native context-busy throw to a 429 stream failure', async () => {
    modelStore.context = fakeContext(
      jest.fn(async () => {
        throw new Error('Context is busy: something');
      }),
    ) as any;
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({
      id: '13',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        messages: [{role: 'user', content: 'hi'}],
        stream: true,
      }),
    });
    // The engine's busy-retry loop sleeps 120ms per attempt (5
    // attempts); give it real time to exhaust and rethrow.
    await new Promise(resolve => setTimeout(resolve, 900));
    expect(r.respondStreamFail.mock.calls.some(c => c[1] === 429)).toBe(true);
  });
});

describe('native-side allowlist mirror', () => {
  it('answers 404 for unknown routes reaching JS anyway', async () => {
    const r = makeResponder();
    ensureApiServerRouter(r);
    emit({id: '20', method: 'GET', path: '/admin'});
    await Promise.resolve();
    expect(r.respond.mock.calls[0][1]).toBe(404);
  });
});
