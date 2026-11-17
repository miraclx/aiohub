import './worker-buffer.ts';
import {renderSynthetic} from './engine.ts';
import {validRequest} from './protocol.ts';
import type {RenderReply} from './protocol.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: RenderReply | {type: 'ready'}): void;
  close(): void;
};
// Defense in depth, not a claim of a general code sandbox. Static imports are
// source-audited; there is no user JS/eval, arbitrary URL or dynamic import.
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'importScripts', 'Worker']) {
  Object.defineProperty(globalThis, name, {value: () => {throw new Error('Network disabled');}, writable: false, configurable: false});
}
let used = false;
scope.onmessage = async event => {
  if (used) return;
  used = true;
  if (!validRequest(event.data)) {scope.close(); return;}
  scope.postMessage(await renderSynthetic(event.data));
  scope.close();
};
scope.postMessage({type: 'ready'});
