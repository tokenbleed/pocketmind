import {DeviceEventEmitter} from 'react-native';
import NativeApiServer from '../../specs/NativeApiServer';
import {modelStore} from '../../store';
import {LocalCompletionEngine} from '../../api/completionEngines';
import type {CompletionStreamData} from '../../utils/completionTypes';
import type {LlamaContext} from 'llama.rn';

/**
 * JS router for the local OpenAI-compatible API server.
 *
 * Native (ApiServerModule) binds the socket, enforces the bearer key,
 * the body cap, and the route allowlist, then forwards each surviving
 * request here as an `apiServerRequest` device event. This module turns
 * it into /v1/models and /v1/chat/completions responses against the
 * loaded local model and streams them back through the module.
 *
 * v1 scope: plain chat completions (no tools), the active local model
 * only, one completion at a time (the context is single).
 */

export interface ApiServerRequest {
  id: string;
  method: string;
  path: string;
  body: string;
}

export interface Responder {
  respond(id: string, status: number, body: string): void;
  respondStreamChunk(id: string, data: string): void;
  respondStreamEnd(id: string): void;
  respondStreamFail(id: string, status: number, message: string): void;
}

const MAX_N_PREDICT = 8192;

let subscription: {remove: () => void} | null = null;
/** Set while a chat completion runs on the shared context. */
let inFlight = false;

function errorJson(message: string, type = 'invalid_request_error'): string {
  return JSON.stringify({error: {message, type}});
}

function jsonRespond(
  responder: Responder,
  id: string,
  status: number,
  payload: unknown,
): void {
  responder.respond(id, status, JSON.stringify(payload));
}

function completionId(): string {
  return `chatcmpl-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** The model id advertised over the API: friendly and stable. */
function activeApiModelId(): string | undefined {
  const model = modelStore.activeModel;
  if (!model || !modelStore.context) {
    return undefined;
  }
  return model.name || model.id;
}

function handleModels(responder: Responder, id: string): void {
  const modelId = activeApiModelId();
  if (!modelId) {
    jsonRespond(responder, id, 200, {object: 'list', data: []});
    return;
  }
  const model = modelStore.activeModel!;
  jsonRespond(responder, id, 200, {
    object: 'list',
    data: [
      {
        id: modelId,
        object: 'model',
        created: 0,
        owned_by: 'local',
        // Extra, non-standard fields clients ignore harmlessly.
        name: model.name,
        params: model.params,
      },
    ],
  });
}

interface OpenAIMessage {
  role?: unknown;
  content?: unknown;
}

/** Flatten OpenAI content (string or parts array) to plain text the
 *  local context accepts. Returns null when the shape is unusable. */
function flattenContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    let text = '';
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const p = part as {type?: unknown; text?: unknown};
      if (p.type === 'text' && typeof p.text === 'string') {
        text += p.text;
      } else if (p.type !== 'text' && typeof (p as any).text !== 'string') {
        // Image parts and the rest are not supported by the local
        // chat endpoint in v1; skip rather than error mid-list.
        continue;
      }
    }
    return text;
  }
  return null;
}

function toEngineMessages(
  raw: unknown,
): {messages: {role: string; content: string}[]} | {error: string} {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {error: 'messages must be a non-empty array'};
  }
  const out: {role: string; content: string}[] = [];
  for (const m of raw as OpenAIMessage[]) {
    if (!m || typeof m !== 'object') {
      return {error: 'each message must be an object'};
    }
    const role = m.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      return {
        error: `unsupported role "${String(role)}"; only system, user, and assistant are supported`,
      };
    }
    const content = flattenContent(m.content);
    if (content === null) {
      return {error: 'message content must be a string or text parts'};
    }
    out.push({role, content});
  }
  return {messages: out};
}

async function handleChatCompletion(
  responder: Responder,
  id: string,
  rawBody: string,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    responder.respond(id, 400, errorJson('request body is not valid JSON'));
    return;
  }
  if (!body || typeof body !== 'object') {
    responder.respond(id, 400, errorJson('request body must be a JSON object'));
    return;
  }

  const context = modelStore.context as LlamaContext | undefined;
  const modelId = activeApiModelId();
  if (!context || !modelId) {
    responder.respond(
      id,
      503,
      errorJson(
        'no local model is loaded; load a model in the app first',
        'api_error',
      ),
    );
    return;
  }

  if (body.model !== undefined && body.model !== modelId) {
    responder.respond(
      id,
      404,
      errorJson(
        `model "${String(body.model)}" is not the loaded model; only "${modelId}" is available`,
      ),
    );
    return;
  }

  const converted = toEngineMessages(body.messages);
  if ('error' in converted) {
    responder.respond(id, 400, errorJson(converted.error));
    return;
  }

  const temperature =
    typeof body.temperature === 'number' && Number.isFinite(body.temperature)
      ? Math.min(Math.max(body.temperature, 0), 2)
      : undefined;
  const topP =
    typeof body.top_p === 'number' && Number.isFinite(body.top_p)
      ? Math.min(Math.max(body.top_p, 0), 1)
      : undefined;
  const maxTokens =
    typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens)
      ? Math.min(Math.max(Math.floor(body.max_tokens), 1), MAX_N_PREDICT)
      : undefined;
  const stop = Array.isArray(body.stop)
    ? body.stop
        .filter((s: unknown): s is string => typeof s === 'string')
        .slice(0, 4)
    : typeof body.stop === 'string'
      ? [body.stop]
      : undefined;

  const stream = body.stream === true;

  if (inFlight) {
    responder.respond(
      id,
      429,
      errorJson(
        'a completion is already running on the model context',
        'api_error',
      ),
    );
    return;
  }
  inFlight = true;

  const engine = new LocalCompletionEngine(context);
  const cmplId = completionId();
  const created = Math.floor(Date.now() / 1000);
  const model = modelStore.activeModel;
  const paramIds: Record<string, unknown> = {};
  if (model?.params) {
    paramIds.params = model.params;
  }

  try {
    if (!stream) {
      const result = await engine.completion({
        messages: converted.messages,
        ...(temperature !== undefined ? {temperature} : {}),
        ...(topP !== undefined ? {top_p: topP} : {}),
        ...(maxTokens !== undefined ? {n_predict: maxTokens} : {}),
        ...(stop !== undefined && stop.length > 0 ? {stop} : {}),
      });
      jsonRespond(responder, id, 200, {
        id: cmplId,
        object: 'chat.completion',
        created,
        model: modelId,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.content ?? result.text ?? '',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: result.tokens_evaluated ?? 0,
          completion_tokens: result.tokens_predicted ?? 0,
          total_tokens:
            (result.tokens_evaluated ?? 0) + (result.tokens_predicted ?? 0),
        },
        ...paramIds,
      });
      return;
    }

    // Streaming: OpenAI-style SSE. The role chunk goes out immediately
    // so the client (and the native response latch) see headers fast.
    const sendChunk = (
      delta: Record<string, unknown>,
      finish: string | null,
    ) => {
      responder.respondStreamChunk(
        id,
        `data: ${JSON.stringify({
          id: cmplId,
          object: 'chat.completion.chunk',
          created,
          model: modelId,
          choices: [{index: 0, delta, finish_reason: finish}],
        })}\n\n`,
      );
    };
    sendChunk({role: 'assistant', content: ''}, null);

    let sawAnyToken = false;
    await engine.completion(
      {
        messages: converted.messages,
        ...(temperature !== undefined ? {temperature} : {}),
        ...(topP !== undefined ? {top_p: topP} : {}),
        ...(maxTokens !== undefined ? {n_predict: maxTokens} : {}),
        ...(stop !== undefined && stop.length > 0 ? {stop} : {}),
      },
      (data: CompletionStreamData) => {
        if (data.token) {
          sawAnyToken = true;
          sendChunk({content: data.token}, null);
        }
        if (data.reasoning_content) {
          sawAnyToken = true;
          sendChunk({reasoning_content: data.reasoning_content}, null);
        }
      },
    );
    if (!sawAnyToken) {
      // Some clients choke on an empty delta list; emit one empty
      // content delta so the shape is always well-formed.
      sendChunk({content: ''}, null);
    }
    sendChunk({}, 'stop');
    responder.respondStreamChunk(id, 'data: [DONE]\n\n');
    responder.respondStreamEnd(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Context is busy')) {
      responder.respondStreamFail(
        id,
        429,
        'a completion is already running on the model context',
      );
    } else {
      responder.respondStreamFail(id, 500, `completion failed: ${msg}`);
    }
  } finally {
    inFlight = false;
  }
}

function handleEvent(responder: Responder, event: ApiServerRequest): void {
  if (event.method === 'GET' && event.path === '/v1/models') {
    handleModels(responder, event.id);
    return;
  }
  if (event.method === 'POST' && event.path === '/v1/chat/completions') {
    // Fire and forget; the handler owns responding on every path.
    void handleChatCompletion(responder, event.id, event.body);
    return;
  }
  // Native already filters; this is belt and braces.
  responder.respond(
    event.id,
    404,
    errorJson(`unknown route ${event.method} ${event.path}`),
  );
}

/** Idempotent: subscribe the router to native request events. */
export function ensureApiServerRouter(responder?: Responder): void {
  if (subscription) {
    return;
  }
  const r: Responder = responder ?? NativeApiServer;
  subscription = DeviceEventEmitter.addListener('apiServerRequest', event => {
    if (!event || typeof event.id !== 'string') {
      return;
    }
    try {
      handleEvent(r, event as ApiServerRequest);
    } catch (err) {
      try {
        r.respondStreamFail(
          event.id,
          500,
          `router error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } catch {
        // Nothing left to try; the native side will time the request out.
      }
    }
  });
}

/** Test hook: detach the listener and reset the in-flight flag. */
export function resetApiServerRouter(): void {
  subscription?.remove();
  subscription = null;
  inFlight = false;
}
