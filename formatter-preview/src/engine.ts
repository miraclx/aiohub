// Internal worker entry only. Do not call this on the browser UI/request thread.
import {CustomFormatter} from '../canonical/formatters/custom.js';
import {validateTemplate} from '../canonical/formatters/engine/parser.js';
import {buildSyntheticFixture} from './fixtures.ts';
import {ENGINE, LIMITS, boundedOutput, byteLength, validRequest} from './protocol.ts';
import type {RenderReply} from './protocol.ts';

export async function renderSynthetic(request: unknown): Promise<RenderReply> {
  if (!validRequest(request)) return {type: 'result', id: 1, ok: false, code: 'invalid-input'};
  const {id, fixtureId, template} = request;
  try {
    let warnings = validateTemplate(template.name).length + validateTemplate(template.description).length;
    if (warnings > LIMITS.diagnostics) return {type: 'result', id, ok: false, code: 'too-many-warnings'};
    const {context, stream} = buildSyntheticFixture(fixtureId);
    const formatter = CustomFormatter.fromConfig(template, {...context, onWarning: () => { warnings++; }});
    const output = await formatter.format(stream);
    if (warnings > LIMITS.diagnostics) return {type: 'result', id, ok: false, code: 'too-many-warnings'};
    const reply: RenderReply = {type: 'result', id, ok: true, output, warnings, fixtureId, engine: ENGINE};
    if (!boundedOutput(output) || byteLength(reply) > LIMITS.responseBytes) return {type: 'result', id, ok: false, code: 'output-too-large'};
    return reply;
  } catch {
    return {type: 'result', id, ok: false, code: 'render-failed'};
  }
}
