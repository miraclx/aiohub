import {Buffer} from 'buffer/index.js';

// Canonical constants use ambient Buffer during module evaluation. This side
// effect must run before the engine imports; it is scoped to the disposable
// worker, never the UI, and reuses the already-reviewed browser dependency.
Object.defineProperty(globalThis, 'Buffer', {value: Buffer, writable: false, configurable: false});
