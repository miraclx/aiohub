// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure and explicit browser Buffer import; original source/notices in upstream/.
import { Buffer } from 'buffer/index.js';
import { formatBytes, formatSmartBytes, formatBitrate, formatSmartBitrate, formatDuration, formatDurationPattern, formatDatePattern, makeSmall, normaliseDuration, } from '../utils.js';
import { languageToCode, languageToEmoji, normaliseLanguage, } from '../../utils/languages.js';
import { compileObjectFilter } from '../../utils/object-filter.js';
import { sanitise, substituteTools } from './sentinels.js';
/**
 * Modifier implementations, and the binding of a modifier's source text to a
 * callable.
 *
 * Arguments are parsed once, at compile time. Type dispatch stays per render
 * because a chain like `stream.size::string::reverse` changes the value's type
 * partway through.
 */
// ---------------------------------------------------------------- plain tables
const toLanguageCode = (value) => {
    const name = normaliseLanguage(value) ?? value;
    return languageToCode(name) || name.toUpperCase();
};
const toLanguageEmoji = (value) => {
    const name = normaliseLanguage(value) ?? value;
    return languageToEmoji(name) ?? '';
};
// Per element, dropping blanks and de-duplicating
const mapLanguages = (value, convert) => [
    ...new Set(value.map((item) => convert(String(item))).filter(Boolean)),
];
const stringModifiers = {
    upper: (value) => value.toUpperCase(),
    lower: (value) => value.toLowerCase(),
    trim: (value) => value.trim(),
    title: (value) => value
        .split(' ')
        .map((word) => word.toLowerCase())
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    length: (value) => value.length.toString(),
    reverse: (value) => value.split('').reverse().join(''),
    base64: (value) => Buffer.from(value, 'utf8').toString('base64'),
    string: (value) => value,
    smallcaps: (value) => makeSmall(value),
    subscript: (value) => mapChars(value, DIGITS, SUBSCRIPT_DIGITS),
    superscript: (value) => mapChars(value, DIGITS, SUPERSCRIPT_DIGITS),
    languagecode: toLanguageCode,
    languageemoji: toLanguageEmoji,
};
const DIGITS = '0123456789+-=()';
const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎';
const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾';
/**
 * Maps characters by position. Anything in `from` without a counterpart in `to`
 * is left alone rather than dropped, so a short `to` cannot silently lose text.
 */
function mapChars(value, from, to) {
    const table = new Map();
    const source = [...from];
    const target = [...to];
    for (let i = 0; i < source.length && i < target.length; i++) {
        table.set(source[i], target[i]);
    }
    return [...value].map((char) => table.get(char) ?? char).join('');
}
export function isObjectList(value) {
    return (Array.isArray(value) && typeof value[0] === 'object' && value[0] !== null);
}
const OBJECT_LIST_MODIFIERS = new Set(['length', 'reverse']);
const arrayGetOrDefault = (value, index) => value.length > 0 ? String(value[index]) : '';
const sortBy = (ascending) => (value) => [...value].sort((a, b) => {
    const result = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true });
    return ascending ? result : -result;
});
const stars = (padWithEmpty) => (value) => {
    const FULL = '★';
    const HALF = '⯪';
    const EMPTY = '☆';
    const full = Math.floor(value / 20);
    const half = value % 20 >= 10 ? 1 : 0;
    return (FULL.repeat(full) +
        HALF.repeat(half) +
        (padWithEmpty ? EMPTY.repeat(5 - full - half) : ''));
};
const arrayModifiers = {
    join: (value) => value.join(', '),
    length: (value) => value.length.toString(),
    first: (value) => arrayGetOrDefault(value, 0),
    last: (value) => arrayGetOrDefault(value, value.length - 1),
    random: (value) => arrayGetOrDefault(value, Math.floor(Math.random() * value.length)),
    sort: sortBy(true),
    rsort: sortBy(false),
    lsort: (value) => [...value].sort(),
    reverse: (value) => [...value].reverse(),
    // ignores case, like the other list comparisons; the first spelling wins
    unique: (value) => {
        const seen = new Set();
        return value.filter((item) => {
            const key = String(item).toLowerCase();
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    },
    languagecode: (value) => mapLanguages(value, toLanguageCode),
    languageemoji: (value) => mapLanguages(value, toLanguageEmoji),
    string: (value) => value.toString(),
};
const numberModifiers = {
    comma: (value) => value.toLocaleString(),
    hex: (value) => value.toString(16),
    octal: (value) => value.toString(8),
    binary: (value) => value.toString(2),
    bytes: (value) => formatBytes(value, 1000),
    sbytes: (value) => formatSmartBytes(value, 1000),
    sbytes10: (value) => formatSmartBytes(value, 1000),
    sbytes2: (value) => formatSmartBytes(value, 1024),
    rbytes: (value) => formatBytes(value, 1000, true),
    bytes10: (value) => formatBytes(value, 1000),
    rbytes10: (value) => formatBytes(value, 1000, true),
    bytes2: (value) => formatBytes(value, 1024),
    rbytes2: (value) => formatBytes(value, 1024, true),
    bitrate: (value) => formatBitrate(value),
    rbitrate: (value) => formatBitrate(value, true),
    sbitrate: (value) => formatSmartBitrate(value),
    string: (value) => value.toString(),
    time: (value) => formatDuration(normaliseDuration(value)),
    star: stars(false),
    pstar: stars(true),
};
const booleanModifiers = {
    string: (value) => String(value),
};
const conditionalModifiers = {
    exact: {
        istrue: (value) => value === true,
        isfalse: (value) => value === false,
        exists: (value) => {
            if (value === undefined || value === null)
                return false;
            if (typeof value === 'string')
                return /\S/.test(value);
            if (Array.isArray(value))
                return value.length > 0;
            return true;
        },
    },
    prefix: {
        $: (value, check) => typeof value === 'string'
            ? value.startsWith(check)
            : value?.[0] === check,
        '^': (value, check) => typeof value === 'string'
            ? value.endsWith(check)
            : value?.[value.length - 1] === check,
        '~': (value, check) => value.includes(check),
        '=': (value, check) => value === check,
        '>=': (value, check) => value >= check,
        '>': (value, check) => value > check,
        '<=': (value, check) => value <= check,
        '<': (value, check) => value < check,
    },
};
/** Plain modifier names grouped by the value type they apply to. */
export const stringModifierNames = Object.keys(stringModifiers);
export const numberModifierNames = Object.keys(numberModifiers);
export const arrayModifierNames = Object.keys(arrayModifiers);
export const booleanModifierNames = Object.keys(booleanModifiers);
/** Argument-free conditionals (`istrue`, `isfalse`, `exists`); apply to any type. */
export const conditionalModifierNames = Object.keys(conditionalModifiers.exact);
export const allModifierNames = [
    ...stringModifierNames,
    ...booleanModifierNames,
    ...numberModifierNames,
    ...arrayModifierNames,
    ...conditionalModifierNames,
];
export const prefixOperators = Object.keys(conditionalModifiers.prefix).sort((a, b) => b.length - a.length);
// ------------------------------------------------------------ argument parsing
/** Pulls quoted arguments out of a call's argument list, in order. */
export function quotedArguments(inner) {
    const args = [];
    const pattern = /"([^"]*)"|'([^']*)'/g;
    let match;
    while ((match = pattern.exec(inner)) !== null) {
        args.push(match[1] ?? match[2] ?? '');
    }
    return args;
}
/**
 * Pulls `{section.property}` references out of a call's argument list. A
 * reference inside a quoted argument is literal text, so it is skipped.
 */
export function referenceArguments(inner) {
    const withoutQuoted = inner.replace(/"[^"]*"|'[^']*'/g, '');
    const pattern = /\{\s*([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
    const found = new Set();
    let match;
    while ((match = pattern.exec(withoutQuoted)) !== null) {
        found.add(match[1]);
    }
    return [...found];
}
/**
 * The literal arguments plus everything the references resolve to. References
 * resolve per render; `literals` is expected to already be in the right case.
 */
function resolveListArgument(literals, references, parseValue, ctx, lower = true) {
    if (!references.length)
        return literals;
    const out = [...literals];
    for (const reference of references) {
        for (const value of ctx.resolveValues(reference, parseValue) ?? []) {
            out.push(lower ? value.toLowerCase() : value);
        }
    }
    return out;
}
/** `"'%H:%M'"` -> `"%H:%M"`; undefined when not quoted. */
function unquote(arg) {
    const quote = arg[0];
    return arg.length >= 2 &&
        (quote === "'" || quote === '"') &&
        arg.endsWith(quote)
        ? arg.slice(1, -1)
        : undefined;
}
/**
 * The longest string a render keeps
 */
export const MAX_RENDER_LENGTH = 8000;
/**
 * `replaceAll` which adheres to `MAX_RENDER_LENGTH`.
 */
function replaceAll(value, search, replacement) {
    if (!search)
        return value;
    const growth = replacement.length - search.length;
    const worstCase = growth <= 0
        ? value.length
        : value.length + Math.floor(value.length / search.length) * growth;
    if (worstCase <= MAX_RENDER_LENGTH) {
        return value.replaceAll(search, replacement);
    }
    let out = '';
    let from = 0;
    while (out.length < MAX_RENDER_LENGTH) {
        const at = value.indexOf(search, from);
        if (at === -1) {
            out += value.slice(from);
            break;
        }
        out += value.slice(from, at) + replacement;
        from = at + search.length;
    }
    return out.length > MAX_RENDER_LENGTH ? out.slice(0, MAX_RENDER_LENGTH) : out;
}
const isReplaceable = (value) => typeof value === 'string' || (Array.isArray(value) && !isObjectList(value));
/** A list matches whole elements, ignoring case, as `keep` and `remove` do. */
function replaceIn(value, search, replacement) {
    if (typeof value === 'string')
        return replaceAll(value, search, replacement);
    const target = search.toLowerCase();
    return value.map((item) => String(item).toLowerCase() === target ? replacement : item);
}
function compileConditional(lower) {
    const exact = conditionalModifiers.exact;
    const isExact = Object.prototype.hasOwnProperty.call(exact, lower);
    const operator = prefixOperators.find((op) => lower.startsWith(op));
    if (!isExact && !operator)
        return undefined;
    const rawCheck = operator ? lower.slice(operator.length) : '';
    const isArrayCapable = operator ? ['$', '^', '~'].includes(operator) : false;
    const isNumericCapable = operator
        ? ['<', '<=', '>', '>=', '='].includes(operator)
        : false;
    return (value) => {
        try {
            // absent values are false without consulting the operator
            if (!exact.exists(value))
                return false;
            if (isExact)
                return exact[lower](value);
            if (isObjectList(value))
                return undefined;
            const arrayValue = Array.isArray(value) && value.every((item) => typeof item === 'string')
                ? value.map((item) => item.toLowerCase())
                : undefined;
            const stringValue = String(value).toLowerCase();
            // whitespace is only stripped from the check when the value has none
            const check = /\s/.test(stringValue)
                ? rawCheck
                : rawCheck.replace(/\s/g, '');
            const numericValue = Number(stringValue.replace(/,\s/g, ''));
            const numericCheck = Number(check.replace(/,\s/g, ''));
            const numeric = isNumericCapable && !isNaN(numericValue) && !isNaN(numericCheck);
            const compare = conditionalModifiers.prefix[operator];
            return compare(numeric
                ? numericValue
                : ((isArrayCapable ? arrayValue : undefined) ?? stringValue), numeric ? numericCheck : check);
        }
        catch {
            return false;
        }
    };
}
function compileParameterised(source, lower) {
    const open = source.indexOf('(');
    if (open === -1 || !source.endsWith(')'))
        return undefined;
    const name = lower.slice(0, open);
    const inner = source.slice(open + 1, -1);
    switch (name) {
        case 'replace': {
            // Split on the separator between the two arguments rather than pairing
            // quotes, so a quote inside an argument stays literal.
            const variableForm = /^\s*\{([^}]+)\}\s*,\s*(['"])([\s\S]*)\2\s*$/.exec(inner);
            if (variableForm) {
                const [, variablePath, , rawReplacement] = variableForm;
                const replacementText = substituteTools(rawReplacement);
                return (value, parseValue, ctx) => {
                    if (!isReplaceable(value))
                        return undefined;
                    const resolved = ctx.resolveVariable(variablePath, parseValue);
                    return resolved ? replaceIn(value, resolved, replacementText) : value;
                };
            }
            const openQuote = source.charAt('replace('.length);
            const closeQuote = source.charAt(source.length - 2);
            const body = source.slice('replace('.length + 1, -2);
            const [rawSearch, replacement, extra] = body.split(new RegExp(`${openQuote}\\s*,\\s*${closeQuote}`));
            // an empty search would match between every character
            if (extra !== undefined || !rawSearch || replacement === undefined) {
                return (value) => (isReplaceable(value) ? value : undefined);
            }
            const variableKey = rawSearch.startsWith('{') && rawSearch.endsWith('}')
                ? rawSearch.slice(1, -1)
                : undefined;
            const replacementText = substituteTools(replacement);
            return (value, parseValue, ctx) => {
                if (!isReplaceable(value))
                    return undefined;
                if (!variableKey)
                    return replaceIn(value, rawSearch, replacementText);
                const resolved = ctx.resolveVariable(variableKey, parseValue);
                if (!resolved)
                    return value;
                return replaceIn(value, resolved, replacementText);
            };
        }
        case 'remove':
        case 'keep': {
            const args = quotedArguments(inner);
            const references = referenceArguments(inner);
            if (args.length === 0 && references.length === 0)
                return () => undefined;
            const targets = args.filter(Boolean);
            const loweredSet = new Set(targets.map((t) => t.toLowerCase()));
            const lowered = [...loweredSet];
            const keeping = name === 'keep';
            return (value, parseValue, ctx) => {
                if (typeof value === 'string') {
                    // keeping part of a single string has no meaning
                    if (keeping)
                        return undefined;
                    let result = value;
                    // removing from a string is a substring match, so case is kept
                    const removals = resolveListArgument(targets, references, parseValue, ctx, false);
                    for (const target of removals)
                        result = result.replaceAll(target, '');
                    return result;
                }
                if (Array.isArray(value) && !isObjectList(value)) {
                    const set = references.length
                        ? new Set(resolveListArgument(lowered, references, parseValue, ctx))
                        : loweredSet;
                    return value.filter((item) => set.has(String(item).toLowerCase()) === keeping);
                }
                return undefined;
            };
        }
        case 'join': {
            const raw = unquote(inner);
            if (raw === undefined)
                return undefined;
            const separator = substituteTools(raw);
            return (value) => Array.isArray(value) && !isObjectList(value)
                ? value.join(separator)
                : undefined;
        }
        case 'where': {
            let filter;
            try {
                filter = compileObjectFilter(quotedArguments(inner));
            }
            catch {
                return () => undefined;
            }
            return (value, parseValue, ctx) => Array.isArray(value) && (!value.length || isObjectList(value))
                ? value.filter((item) => filter(item, (path) => ctx.resolveValues(path, parseValue)))
                : undefined;
        }
        case 'pluck': {
            const key = unquote(inner);
            if (key === undefined)
                return undefined;
            return (value) => {
                if (!Array.isArray(value))
                    return undefined;
                if (value.length && !isObjectList(value))
                    return undefined;
                const found = new Set();
                for (const item of value) {
                    const field = item[key];
                    for (const entry of Array.isArray(field) ? field : [field]) {
                        if (typeof entry === 'string' && entry)
                            found.add(sanitise(entry));
                    }
                }
                return [...found];
            };
        }
        case 'truncate': {
            const limit = parseInt(inner, 10);
            if (isNaN(limit) || limit < 0)
                return undefined;
            const segmenter = new Intl.Segmenter();
            return (value) => {
                if (typeof value !== 'string')
                    return undefined;
                const graphemes = [...segmenter.segment(value)];
                if (graphemes.length <= limit)
                    return value;
                return (graphemes
                    .slice(0, limit)
                    .map((s) => s.segment)
                    .join('')
                    .replace(/\s+$/, '') + '…');
            };
        }
        case 'slice': {
            const parts = inner.split(',').map((part) => parseInt(part.trim(), 10));
            if (isNaN(parts[0]))
                return undefined;
            const [start, end] = [
                parts[0],
                parts.length > 1 && !isNaN(parts[1]) ? parts[1] : undefined,
            ];
            return (value) => Array.isArray(value) ? value.slice(start, end) : undefined;
        }
        case 'default': {
            const fallback = unquote(inner);
            if (fallback === undefined)
                return undefined;
            return (value) => conditionalModifiers.exact.exists(value) ? value : fallback;
        }
        case 'trim': {
            const chars = unquote(inner);
            if (chars === undefined)
                return undefined;
            const strip = new Set(chars);
            return (value) => {
                if (typeof value !== 'string')
                    return undefined;
                const points = [...value];
                let start = 0;
                let end = points.length;
                while (start < end && strip.has(points[start]))
                    start += 1;
                while (end > start && strip.has(points[end - 1]))
                    end -= 1;
                return points.slice(start, end).join('');
            };
        }
        case 'translate': {
            const [from, to] = quotedArguments(inner);
            if (from === undefined || to === undefined)
                return undefined;
            return (value) => typeof value === 'string' ? mapChars(value, from, to) : undefined;
        }
        case 'in': {
            const options = quotedArguments(inner).map((option) => option.toLowerCase());
            const references = referenceArguments(inner);
            if (options.length === 0 && references.length === 0)
                return undefined;
            const literalSet = new Set(options);
            return (value, parseValue, ctx) => {
                if (value === null || value === undefined)
                    return false;
                if (isObjectList(value))
                    return undefined;
                const set = references.length
                    ? new Set(resolveListArgument(options, references, parseValue, ctx))
                    : literalSet;
                if (Array.isArray(value)) {
                    return value.some((item) => typeof item === 'string' && set.has(item.toLowerCase()));
                }
                return set.has(String(value).toLowerCase());
            };
        }
        case 'time': {
            const pattern = unquote(inner);
            if (pattern === undefined)
                return undefined;
            return (value) => typeof value === 'number'
                ? formatDurationPattern(normaliseDuration(value), pattern)
                : undefined;
        }
        case 'date': {
            const pattern = unquote(inner);
            if (pattern === undefined)
                return undefined;
            return (value) => typeof value === 'string'
                ? formatDatePattern(value, pattern)
                : undefined;
        }
        default:
            return undefined;
    }
}
function compilePlain(lower) {
    return (value) => {
        if (typeof value === 'string') {
            const fn = stringModifiers[lower];
            return fn ? fn(value) : undefined;
        }
        if (Array.isArray(value)) {
            if (isObjectList(value) && !OBJECT_LIST_MODIFIERS.has(lower)) {
                return undefined;
            }
            const fn = arrayModifiers[lower];
            return fn ? fn(value) : undefined;
        }
        if (typeof value === 'number') {
            const fn = numberModifiers[lower];
            return fn ? fn(value) : undefined;
        }
        if (typeof value === 'boolean') {
            const fn = booleanModifiers[lower];
            return fn ? fn(value) : undefined;
        }
        return undefined;
    };
}
/**
 * Order matters: conditionals are tested first because `::exists` and `::>5`
 * apply to every type.
 */
export function compileModifier(source) {
    const lower = source.toLowerCase();
    return (compileConditional(lower) ??
        compileParameterised(source, lower) ??
        compilePlain(lower));
}
