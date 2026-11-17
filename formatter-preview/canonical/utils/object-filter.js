// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
const CONDITION = /^(!?)\s*([A-Za-z]+)\s*(?:([=~])(.*))?$/;
const REFERENCE = /^\{\s*([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\}$/;
export function compileObjectFilter(conditions) {
    const tests = conditions.map(compileCondition);
    return (object, resolve) => tests.every((test) => test(object, resolve));
}
/** Every `{section.property}` the conditions read, for validation. */
export function objectFilterReferences(conditions) {
    const found = new Set();
    for (const condition of conditions) {
        const match = CONDITION.exec(condition.trim());
        if (!match?.[4])
            continue;
        for (const part of match[4].split('|')) {
            const reference = REFERENCE.exec(part.trim());
            if (reference)
                found.add(reference[1]);
        }
    }
    return [...found];
}
function compileCondition(condition) {
    const match = CONDITION.exec(condition.trim());
    if (!match)
        throw new Error(`invalid condition '${condition}'`);
    const [, bang, key, operator, rawValue] = match;
    const negate = bang === '!';
    if (!operator) {
        return (object) => !!object[key] !== negate;
    }
    const parts = rawValue.split('|').map((value) => value.trim());
    const references = parts
        .map((part) => REFERENCE.exec(part)?.[1])
        .filter((path) => path !== undefined);
    const literals = parts
        .filter((part) => !REFERENCE.test(part))
        .map((value) => value.toLowerCase())
        .filter(Boolean);
    const test = operator === '='
        ? (values, actual) => values.includes(actual)
        : (values, actual) => values.some((value) => actual.includes(value));
    return (object, resolve) => {
        const values = references.length
            ? [
                ...literals,
                ...references.flatMap((path) => (resolve?.(path) ?? []).map((value) => value.toLowerCase())),
            ]
            : literals;
        const actual = object[key];
        const entries = Array.isArray(actual) ? actual : [actual];
        return (entries.some((entry) => entry != null && test(values, String(entry).toLowerCase())) !== negate);
    };
}
