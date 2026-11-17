import {ERROR_MESSAGES, LIMITS, validReply, validRequest} from './protocol.ts';
import type {ErrorCode, FixtureId, RenderReply, RenderRequest, Template} from './protocol.ts';
export type {FixtureId, Template} from './protocol.ts';
export {ENGINE, FIXTURES} from './protocol.ts';
export type PreviewResult = Extract<RenderReply, {ok: true}>;
export class PreviewError extends Error {
  constructor(public readonly code: ErrorCode) {super(ERROR_MESSAGES[code]); this.name = 'PreviewError';}
}
export interface PreviewWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(request: RenderRequest): void;
  terminate(): void;
}
export type WorkerFactory = () => PreviewWorker;
const browserWorker: WorkerFactory = () => new Worker(new URL('./formatter.worker.ts', import.meta.url), {type: 'module', name: 'aiohub-synthetic-formatter'});

// One disposable worker per explicit Preview. No background worker/cache survives
// success, failure, cancellation, timeout, unmount or a newer request.
export class FormatterPreviewClient {
  private sequence = 0;
  private cancelPending: (() => void) | undefined;
  constructor(private readonly factory: WorkerFactory = browserWorker, private readonly deadlines: {startupMs: number; renderMs: number} = {startupMs: LIMITS.startupMs, renderMs: LIMITS.renderMs}) {}
  cancel(): void {this.cancelPending?.();}
  render(template: Template, fixtureId: FixtureId = 'basic'): Promise<PreviewResult> {
    this.cancel();
    this.sequence = this.sequence % 1_000_000_000 + 1;
    const request: RenderRequest = {type: 'render', id: this.sequence, fixtureId, template};
    // Validate descriptors before copying: spreading first would invoke a caller's
    // accessors on the UI thread, outside both the protocol and worker deadline.
    if (!validRequest(request)) return Promise.reject(new PreviewError('invalid-input'));
    request.template = {...template};
    return new Promise((resolve, reject) => {
      let worker: PreviewWorker;
      try {worker = this.factory();} catch {reject(new PreviewError('unavailable')); return;}
      let settled = false;
      let ready = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (result?: PreviewResult, error?: ErrorCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
        worker.terminate();
        if (this.cancelPending === cancel) this.cancelPending = undefined;
        if (result) resolve(result); else reject(new PreviewError(error || 'render-failed'));
      };
      const cancel = () => finish(undefined, 'cancelled');
      this.cancelPending = cancel;
      timer = setTimeout(() => finish(undefined, 'timeout'), this.deadlines.startupMs);
      worker.onerror = event => {event.preventDefault(); finish(undefined, 'render-failed');};
      worker.onmessageerror = () => finish(undefined, 'render-failed');
      worker.onmessage = event => {
        if (settled) return;
        const message = event.data;
        if (!ready && message && typeof message === 'object' && Object.keys(message).length === 1 && 'type' in message && message.type === 'ready') {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => finish(undefined, 'timeout'), this.deadlines.renderMs);
          try {worker.postMessage(request);} catch {finish(undefined, 'render-failed');}
          return;
        }
        if (!ready || !validReply(message)) {finish(undefined, 'render-failed'); return;}
        if (message.id !== request.id) return;
        if (!message.ok) {finish(undefined, message.code); return;}
        if (message.fixtureId !== request.fixtureId) {finish(undefined, 'render-failed'); return;}
        finish(message);
      };
    });
  }
}
