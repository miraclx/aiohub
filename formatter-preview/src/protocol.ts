export const ENGINE = 'AIOStreams v2.37.0 (ed8b085)' as const;
export const LIMITS = Object.freeze({templateChars: 15_000, requestBytes: 128 * 1024, outputChars: 16_000, responseBytes: 128 * 1024, diagnostics: 25, startupMs: 2_000, renderMs: 250});
export const FIXTURES = Object.freeze([
  {id: 'basic', label: 'Basic synthetic stream'},
  {id: 'detailed', label: 'Synthetic quality, languages and tracks'},
  {id: 'missing', label: 'Missing optional metadata'},
] as const);
export type FixtureId = typeof FIXTURES[number]['id'];
export type Template = {name: string; description: string};
export type ErrorCode = 'invalid-input' | 'unavailable' | 'timeout' | 'cancelled' | 'render-failed' | 'output-too-large' | 'too-many-warnings';
export type RenderRequest = {type: 'render'; id: number; fixtureId: FixtureId; template: Template};
export type RenderReply = {type: 'result'; id: number} & (
  {ok: true; output: Template; warnings: number; engine: typeof ENGINE; fixtureId: FixtureId} |
  {ok: false; code: ErrorCode}
);
const errorCodes: readonly ErrorCode[] = ['invalid-input', 'unavailable', 'timeout', 'cancelled', 'render-failed', 'output-too-large', 'too-many-warnings'];
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  'invalid-input': 'This preview input exceeds the supported limits.',
  unavailable: 'Local preview is unavailable in this browser.',
  timeout: 'This template took too long to preview. Try a simpler version.',
  cancelled: 'Preview cancelled.',
  'render-failed': 'This template could not be rendered locally.',
  'output-too-large': 'This template produced more preview text than allowed.',
  'too-many-warnings': 'This template produced too many formatter warnings.',
};
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]);
}
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0 && Number(id) <= 1_000_000_000;
export const validFixture = (id: unknown): id is FixtureId => FIXTURES.some(fixture => fixture.id === id);
export function validTemplate(value: unknown): value is Template {
  return record(value, ['name', 'description']) && typeof value.name === 'string' && typeof value.description === 'string' && value.name.length <= LIMITS.templateChars && value.description.length <= LIMITS.templateChars;
}
export function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export function validRequest(value: unknown): value is RenderRequest {
  try {
    return record(value, ['type', 'id', 'fixtureId', 'template']) && value.type === 'render' && validId(value.id) && validFixture(value.fixtureId) && validTemplate(value.template) && byteLength(value) <= LIMITS.requestBytes;
  } catch { return false; }
}
export function boundedOutput(value: unknown): value is Template {
  return record(value, ['name', 'description']) && typeof value.name === 'string' && typeof value.description === 'string' && value.name.length <= LIMITS.outputChars && value.description.length <= LIMITS.outputChars;
}
export function validReply(value: unknown): value is RenderReply {
  try {
    if (!value || typeof value !== 'object') return false;
    const ok = Object.getOwnPropertyDescriptor(value, 'ok');
    if (!ok || !('value' in ok)) return false;
    if (ok.value === false) return record(value, ['type', 'id', 'ok', 'code']) && value.type === 'result' && validId(value.id) && errorCodes.includes(value.code as ErrorCode);
    return record(value, ['type', 'id', 'ok', 'output', 'warnings', 'engine', 'fixtureId']) && value.type === 'result' && value.ok === true && validId(value.id) && boundedOutput(value.output) && Number.isSafeInteger(value.warnings) && Number(value.warnings) >= 0 && Number(value.warnings) <= LIMITS.diagnostics && value.engine === ENGINE && validFixture(value.fixtureId) && byteLength(value) <= LIMITS.responseBytes;
  } catch { return false; }
}
