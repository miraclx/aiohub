// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
/**
 * Template AST.
 *
 * `RawText` is a node rather than an error path because unparseable spans are
 * still rendered, verbatim, into output the user sees.
 */
export function rawText(text) {
    return { kind: 'raw', text };
}
