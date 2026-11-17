// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
/**
 * Layout directives travel through a render as control characters so that only
 * the template can emit them. Rendered values are stripped of them on the way
 * in, which stops a filename from deleting a line of output.
 */
export const NEW_LINE_SENTINEL = '\u0011';
export const REMOVE_LINE_SENTINEL = '\u0012';
const SENTINEL_PATTERN = /[\u0011\u0012]/g;
export function hasSentinel(text) {
    return (text.includes(NEW_LINE_SENTINEL) || text.includes(REMOVE_LINE_SENTINEL));
}
/** Applied where data enters a render, never to finished output. */
export function sanitise(text) {
    return hasSentinel(text) ? text.replace(SENTINEL_PATTERN, '') : text;
}
/** Directives written inside a modifier argument, e.g. `join('{tools.newLine}- ')`. */
export function substituteTools(text) {
    return text
        .replaceAll('{tools.newLine}', NEW_LINE_SENTINEL)
        .replaceAll('{tools.removeLine}', REMOVE_LINE_SENTINEL);
}
