import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Local OpenAI-compatible API server. Serves GET /v1/models and
 * POST /v1/chat/completions (streaming and non-streaming) from the
 * loaded local model, so other apps on the device or machines on the
 * LAN can use the phone as an endpoint.
 *
 * Requests arrive in JS as `apiServerRequest` device events carrying
 * {id, method, path, body}; JS answers through respond/respondStream*
 * calls keyed by that id. Unknown paths, wrong methods, oversized
 * bodies, and missing bearer keys are rejected natively before the
 * event is ever emitted.
 */
export interface Spec extends TurboModule {
  /** Bind the server. Resolves with the reachable address
   *  ("host:port") or rejects when the port is taken. Starting an
   *  already-running server re-resolves with its address. */
  start(
    port: number,
    bindAll: boolean,
    apiKey: string,
  ): Promise<string> /** Unbind and drop every in-flight request. Resolves when down. */;
  stop(): Promise<void>;
  /** Answer request `id` with a complete JSON response. */
  respond(id: string, status: number, body: string): void;
  /** Append one chunk to request `id`'s SSE stream. The first call
   *  opens the stream; later calls after respondEnd are dropped. */
  respondStreamChunk(id: string, data: string): void;
  /** Finish request `id`'s stream (or emit an empty stream when no
   *  chunk was ever written). */
  respondStreamEnd(id: string): void;
  /** Abort request `id`: before the first chunk this answers with a
   *  JSON error status; afterwards it just closes the stream. */
  respondStreamFail(id: string, status: number, message: string): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ApiServer');
