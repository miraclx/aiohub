// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
/**
 * Comparators joining operands inside one expression:
 * `{a::exists::and::b::exists["yes"||"no"]}`.
 *
 * `left` and `right` look odd but are the documented way to discard one side of
 * a comparison, so they stay.
 */
export const comparatorFunctions = {
    and: (a, b) => a && b,
    or: (a, b) => a || b,
    xor: (a, b) => (a || b) && !(a && b),
    neq: (a, b) => a !== b,
    equal: (a, b) => a === b,
    left: (a) => a,
    right: (_, b) => b,
};
export const comparatorNames = Object.keys(comparatorFunctions);
