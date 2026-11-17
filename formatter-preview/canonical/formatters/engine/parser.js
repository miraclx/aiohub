// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
import { rawText, } from './ast.js';
import { OBJECT_LISTS, canonicaliseField, nearestName, suggestField, } from './fields.js';
import { allModifierNames, prefixOperators, quotedArguments, referenceArguments, } from './modifiers.js';
import { comparatorNames } from './comparators.js';
import { compileObjectFilter, objectFilterReferences, } from '../../utils/object-filter.js';
/**
 * Single-pass template parser. Linear in template length with a bounded stack,
 * so no input can make it backtrack.
 *
 * Governing rule: a parse failure inside `{...}` emits that span as literal
 * text and resumes one character past the brace, so a nested `{` can still
 * open a valid expression.
 */
const comparators = () => comparatorNames;
/** Longest first, so `sbytes10` wins over `sbytes`. */
const plainModifiers = () => PLAIN_MODIFIERS;
const PLAIN_MODIFIERS = [...allModifierNames]
    .map((name) => name.toLowerCase())
    .sort((a, b) => b.length - a.length);
/** Longest first, so `>=` wins over `>`. */
const PREFIX_OPERATORS = prefixOperators;
export const CALL_MODIFIERS = [
    ['replace', 'replaceArgs'],
    ['remove', 'loose'],
    ['keep', 'loose'],
    ['join', 'quoted'],
    ['truncate', 'digits'],
    ['slice', 'digitsOrPair'],
    ['time', 'quoted'],
    ['date', 'quoted'],
    ['default', 'quoted'],
    ['in', 'loose'],
    ['translate', 'quotedPair'],
    ['trim', 'quoted'],
    ['where', 'quotedList'],
    ['pluck', 'quoted'],
    ['each', 'template'],
];
const LOOKS_LIKE_EXPRESSION = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/;
/** Caps so a pathological template cannot produce unbounded diagnostic work. */
const MAX_DIAGNOSTICS = 25;
const MAX_SPAN_SCAN = 4000;
const MAX_BRANCH_DEPTH = 5;
/**
 * Recovery resumes one character past a failed `{`, so text nested inside it is
 * re-scanned as though it were top level.
 */
const NESTED_SAFE_CATEGORIES = new Set([
    'unknown-field',
    'unknown-modifier',
    'modifier-arguments',
]);
/**
 * Advisory only. Saved templates may contain spans that have always rendered as
 * literal text, so a diagnostic is not grounds for rejecting a config.
 */
export function validateTemplate(template) {
    const { nodes, diagnostics } = parseTemplate(template);
    // top-level node positions are already document offsets, so the identity map
    const all = [...diagnostics, ...nestedDiagnostics(nodes, template, (i) => i)];
    const seen = new Set();
    return all.filter((d) => {
        const key = `${d.index}:${d.message}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
/**
 * Maps an index within a branch's unescaped text back to a document offset.
 * Replays `parseCheck`'s branch scan from `start`, so `\"` escapes (one
 * unescaped char at the backslash) and brace depth line up exactly; indices
 * past the branch resolve to its closing quote.
 */
function buildBranchMapper(doc, start) {
    const offsets = [];
    let pos = start;
    let depth = 0;
    while (pos < doc.length) {
        const char = doc[pos];
        if (char === '\\' && doc[pos + 1] === '"') {
            offsets.push(pos);
            pos += 2;
            continue;
        }
        if (char === '{')
            depth += 1;
        else if (char === '}')
            depth = Math.max(0, depth - 1);
        else if (char === '"' && depth === 0)
            break;
        offsets.push(pos);
        pos += 1;
    }
    const end = pos;
    return (index) => index >= 0 && index < offsets.length ? offsets[index] : end;
}
/**
 * Conditional branches and `each()` templates are stored as raw strings and
 * only compiled at render time, so nothing else ever validates them. Walked
 * here rather than in `parseTemplate` to keep this off the render path.
 *
 * `mapToDoc` translates a position in the string these `nodes` were parsed from
 * into a document offset; each branch composes a fresh mapper so a diagnostic
 * nested any number of levels deep still lands on its exact character.
 */
function nestedDiagnostics(nodes, doc, mapToDoc, depth = 0, inEach = false) {
    if (depth > MAX_BRANCH_DEPTH)
        return [];
    const out = [];
    for (const node of nodes) {
        if (node.kind === 'group') {
            out.push(...nestedDiagnostics(node.nodes, doc, mapToDoc, depth + 1, inEach));
            continue;
        }
        if (node.kind !== 'expression')
            continue;
        out.push(...operandDiagnostics(node, doc, mapToDoc, depth, inEach));
        if (!node.check)
            continue;
        const branches = [
            [node.check.trueTemplate, node.check.trueStart],
            [node.check.falseTemplate, node.check.falseStart],
            [node.check.absentTemplate, node.check.absentStart],
        ];
        for (const [branch, startInParsed] of branches) {
            if (branch === undefined || startInParsed === undefined)
                continue;
            const localMapper = buildBranchMapper(doc, mapToDoc(startInParsed));
            const inner = parseTemplate(branch);
            out.push(...inner.diagnostics.map((d) => ({
                ...d,
                index: localMapper(d.index),
                message: `inside conditional branch: ${d.message}`,
            })));
            out.push(...nestedDiagnostics(inner.nodes, doc, localMapper, depth + 1, inEach));
        }
    }
    return out;
}
/** Modifiers whose arguments may name a field, as `{section.property}`. */
const REFERENCE_MODIFIERS = new Set([
    'where',
    'in',
    'keep',
    'remove',
]);
/** `where`, `pluck`, `each` and `track.*` parse anywhere but only work in place. */
function operandDiagnostics(node, doc, mapToDoc, depth, inEach) {
    const out = [];
    const base = node.start ?? 0;
    // a moving cursor, so repeated text is found at the right occurrence
    const source = node.source.toLowerCase();
    let cursor = 0;
    const locate = (text) => {
        const at = source.indexOf(text.toLowerCase(), cursor);
        if (at === -1)
            return cursor;
        cursor = at + text.length;
        return at;
    };
    const at = (from, text, category, message) => ({
        index: mapToDoc(base + from),
        message,
        source: text,
        category,
    });
    for (const operand of node.operands) {
        const field = `${operand.section}.${operand.property}`;
        if (operand.literal === undefined) {
            const fieldAt = locate(field);
            if (operand.section === 'track' && !inEach) {
                out.push(at(fieldAt, field, 'unknown-field', `\`${field}\` is only set inside \`::each(...)\``));
            }
        }
        let isList = operand.literal === undefined && OBJECT_LISTS.has(field);
        for (const modifier of operand.modifiers) {
            const modifierAt = locate(modifier);
            const open = modifier.indexOf('(');
            const name = (open === -1 ? modifier : modifier.slice(0, open)).toLowerCase();
            if (open !== -1 && REFERENCE_MODIFIERS.has(name)) {
                const inner = modifier.slice(open + 1, -1);
                // `where`'s references sit inside its quoted conditions
                const references = name === 'where'
                    ? objectFilterReferences(quotedArguments(inner))
                    : referenceArguments(inner);
                for (const reference of references) {
                    const [section, property] = reference.split('.');
                    if (canonicaliseField(section, property))
                        continue;
                    const suggestion = suggestField(section, property)[0];
                    out.push({
                        ...at(modifierAt, modifier, 'unknown-field', `\`::${name}\`: unknown field \`${reference}\``),
                        ...(suggestion ? { suggestion } : {}),
                    });
                }
            }
            if (name !== 'where' && name !== 'pluck' && name !== 'each') {
                if (name !== 'slice' && name !== 'reverse')
                    isList = false;
                continue;
            }
            const problem = (message) => out.push(at(modifierAt, modifier, 'modifier-arguments', message));
            if (!isList) {
                problem(`\`::${name}\` only applies to a list of objects, such as \`stream.audioTracks\``);
            }
            else if (name === 'where') {
                try {
                    compileObjectFilter(quotedArguments(modifier.slice(open + 1, -1)));
                }
                catch (error) {
                    problem(`\`::where\`: ${error.message}`);
                }
            }
            else if (name === 'each' && inEach) {
                problem('`::each` cannot be used inside another `::each`');
            }
            else if (name === 'each') {
                const argument = eachTemplate(modifier);
                if (argument) {
                    const toModifier = templateArgumentMapper(argument);
                    const toDoc = (index) => mapToDoc(base + modifierAt + toModifier(index));
                    const inner = parseTemplate(argument.content);
                    out.push(...inner.diagnostics.map((d) => ({
                        ...d,
                        index: toDoc(d.index),
                        message: `inside each(): ${d.message}`,
                    })));
                    out.push(...nestedDiagnostics(inner.nodes, doc, toDoc, depth + 1, true));
                }
            }
            if (name !== 'where')
                isList = false;
        }
    }
    return out;
}
class Scanner {
    input;
    pos;
    constructor(input, pos = 0) {
        this.input = input;
        this.pos = pos;
    }
    get atEnd() {
        return this.pos >= this.input.length;
    }
    peek(offset = 0) {
        return this.input[this.pos + offset];
    }
    /** Case-insensitive literal match, consuming on success. */
    eat(literal) {
        const slice = this.input.substr(this.pos, literal.length);
        if (slice.toLowerCase() !== literal.toLowerCase())
            return false;
        this.pos += literal.length;
        return true;
    }
    startsWith(literal) {
        return (this.input.substr(this.pos, literal.length).toLowerCase() ===
            literal.toLowerCase());
    }
    slice(from, to = this.pos) {
        return this.input.slice(from, to);
    }
}
/** Terminates a section/property name, so no lookahead is needed. */
function isIdentifierChar(char) {
    return char !== undefined && /[A-Za-z0-9_]/.test(char);
}
/** Unquoted prefix argument: anything but `}`, `[`, `]`, stopping at `::`. */
function scanPrefixArgument(scanner) {
    while (!scanner.atEnd) {
        const char = scanner.peek();
        if (char === '}' || char === '[' || char === ']')
            break;
        if (char === ':' && scanner.peek(1) === ':')
            break;
        scanner.pos += 1;
    }
}
/**
 * A quote only closes the argument when followed by `,`, `)` or whitespace, so
 * an apostrophe mid-word stays literal: `replace("Director's Cut", 'x')`.
 */
function scanQuotedArgument(scanner) {
    const quote = scanner.peek();
    if (quote !== "'" && quote !== '"')
        return false;
    scanner.pos += 1;
    while (!scanner.atEnd) {
        if (scanner.peek() === quote) {
            const after = scanner.peek(1);
            if (after === undefined ||
                after === ',' ||
                after === ')' ||
                /\s/.test(after)) {
                scanner.pos += 1;
                return true;
            }
        }
        scanner.pos += 1;
    }
    return false;
}
/**
 * As in a conditional branch, a quote inside a nested `{...}` does not close
 * it, and a backslash escapes the quote.
 */
export function scanTemplateArgument(text, start) {
    const quote = text[start];
    if (quote !== '"' && quote !== "'")
        return undefined;
    let content = '';
    const offsets = [];
    let depth = 0;
    let pos = start + 1;
    while (pos < text.length) {
        const char = text[pos];
        if (char === '\\' && text[pos + 1] === quote) {
            offsets.push(pos);
            content += quote;
            pos += 2;
            continue;
        }
        if (char === '{')
            depth += 1;
        else if (char === '}')
            depth = Math.max(0, depth - 1);
        else if (char === quote && depth === 0) {
            return { content, offsets, end: pos + 1 };
        }
        offsets.push(pos);
        content += char;
        pos += 1;
    }
    return undefined;
}
function templateArgumentMapper(argument) {
    return (index) => index >= 0 && index < argument.offsets.length
        ? argument.offsets[index]
        : argument.end - 1;
}
export function eachTemplate(source) {
    if (!/^each\(/i.test(source))
        return undefined;
    let start = 'each('.length;
    while (/\s/.test(source[start] ?? ''))
        start += 1;
    return scanTemplateArgument(source, start);
}
function scanDigits(scanner) {
    const start = scanner.pos;
    while (scanner.peek() !== undefined && /\d/.test(scanner.peek())) {
        scanner.pos += 1;
    }
    return scanner.pos > start;
}
function skipSpaces(scanner) {
    while (scanner.peek() !== undefined && /\s/.test(scanner.peek())) {
        scanner.pos += 1;
    }
}
/**
 * The argument may itself contain parentheses, as in `remove('DV (Disk)')`, so
 * it ends at the last `)` in range rather than the first.
 */
const LOOSE_REFERENCE = /^\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\}$/;
function scanLooseArgument(scanner) {
    let lastParen = -1;
    while (!scanner.atEnd) {
        const char = scanner.peek();
        // a quoted argument is literal, braces and parens included
        if (char === "'" || char === '"') {
            const close = scanner.input.indexOf(char, scanner.pos + 1);
            if (close !== -1) {
                scanner.pos = close + 1;
                continue;
            }
        }
        // a reference's braces must not end the argument list, but anything else
        // brace-shaped still does, so an unclosed `{` cannot run away
        if (char === '{') {
            const close = scanner.input.indexOf('}', scanner.pos);
            const span = close === -1 ? '' : scanner.slice(scanner.pos, close + 1);
            if (!LOOSE_REFERENCE.test(span))
                break;
            scanner.pos = close + 1;
            continue;
        }
        if (char === '}' || char === '[' || char === ']')
            break;
        if (char === ':' && scanner.peek(1) === ':')
            break;
        if (char === ')')
            lastParen = scanner.pos;
        scanner.pos += 1;
    }
    if (lastParen === -1)
        return false;
    scanner.pos = lastParen;
    return true;
}
function scanCallArguments(scanner, shape) {
    if (!scanner.eat('('))
        return false;
    switch (shape) {
        case 'quoted':
            if (!scanQuotedArgument(scanner))
                return false;
            break;
        case 'quotedPair':
            if (!scanQuotedArgument(scanner))
                return false;
            skipSpaces(scanner);
            if (!scanner.eat(','))
                return false;
            skipSpaces(scanner);
            if (!scanQuotedArgument(scanner))
                return false;
            break;
        case 'quotedList':
            do {
                skipSpaces(scanner);
                if (!scanQuotedArgument(scanner))
                    return false;
                skipSpaces(scanner);
            } while (scanner.eat(','));
            break;
        case 'template': {
            skipSpaces(scanner);
            const argument = scanTemplateArgument(scanner.input, scanner.pos);
            if (!argument)
                return false;
            scanner.pos = argument.end;
            skipSpaces(scanner);
            break;
        }
        case 'replaceArgs':
            // the search key may be a {variable} rather than a quoted string
            if (scanner.peek() === '{') {
                while (!scanner.atEnd && scanner.peek() !== '}')
                    scanner.pos += 1;
                if (!scanner.eat('}'))
                    return false;
            }
            else if (!scanQuotedArgument(scanner)) {
                return false;
            }
            skipSpaces(scanner);
            if (!scanner.eat(','))
                return false;
            skipSpaces(scanner);
            if (!scanQuotedArgument(scanner))
                return false;
            break;
        case 'digits':
            if (!scanDigits(scanner))
                return false;
            break;
        case 'digitsOrPair':
            skipSpaces(scanner);
            if (!scanDigits(scanner))
                return false;
            skipSpaces(scanner);
            if (scanner.eat(',')) {
                skipSpaces(scanner);
                if (!scanDigits(scanner))
                    return false;
                skipSpaces(scanner);
            }
            break;
        case 'loose':
            // consumes up to its own closing paren, so return directly
            return scanLooseArgument(scanner) && scanner.eat(')');
    }
    return scanner.eat(')');
}
/** One `::modifier`. Returns the modifier's source text, or undefined. */
function parseModifier(scanner) {
    const start = scanner.pos;
    for (const [name, shape] of CALL_MODIFIERS) {
        if (!scanner.startsWith(`${name}(`))
            continue;
        scanner.pos += name.length;
        if (scanCallArguments(scanner, shape))
            return scanner.slice(start);
        // wrong shape is not a match; a prefix or plain modifier may still fit
        scanner.pos = start;
        break;
    }
    for (const operator of PREFIX_OPERATORS) {
        if (scanner.startsWith(operator)) {
            scanner.pos += operator.length;
            scanPrefixArgument(scanner);
            return scanner.slice(start);
        }
    }
    for (const name of plainModifiers()) {
        if (!scanner.startsWith(name))
            continue;
        const after = scanner.peek(name.length);
        // must end at a boundary, so `upper` does not match `uppercase`
        if (isIdentifierChar(after))
            continue;
        scanner.pos += name.length;
        return scanner.slice(start);
    }
    scanner.pos = start;
    return undefined;
}
/** `section.property`, case preserved. */
function parseOperandHead(scanner) {
    const start = scanner.pos;
    while (isIdentifierChar(scanner.peek()))
        scanner.pos += 1;
    let section = scanner.slice(start);
    if (!section || scanner.peek() !== '.') {
        scanner.pos = start;
        return undefined;
    }
    scanner.pos += 1;
    const propertyStart = scanner.pos;
    while (isIdentifierChar(scanner.peek()))
        scanner.pos += 1;
    let property = scanner.slice(propertyStart);
    if (!property) {
        scanner.pos = start;
        return undefined;
    }
    // an unknown property is not an expression at all, so it stays literal
    const canonical = canonicaliseField(section, property);
    if (!canonical) {
        scanner.pos = start;
        return undefined;
    }
    // stored canonically so lookup does not depend on how it was typed
    [section, property] = canonical;
    return { section, property };
}
function parseOperand(scanner) {
    // a quoted literal stands in for a field
    let head;
    if (scanner.peek() === "'" || scanner.peek() === '"') {
        const quote = scanner.peek();
        const start = scanner.pos;
        scanner.pos += 1;
        const from = scanner.pos;
        while (!scanner.atEnd && scanner.peek() !== quote)
            scanner.pos += 1;
        if (scanner.atEnd) {
            scanner.pos = start;
            return undefined;
        }
        const literal = scanner.slice(from);
        scanner.pos += 1;
        head = { section: '', property: '', literal };
    }
    else {
        head = parseOperandHead(scanner);
    }
    if (!head)
        return undefined;
    const modifiers = [];
    while (scanner.startsWith('::')) {
        // a comparator ends this operand rather than extending it
        const save = scanner.pos;
        scanner.pos += 2;
        if (comparators().some((c) => scanner.startsWith(`${c}::`))) {
            scanner.pos = save;
            break;
        }
        const modifier = parseModifier(scanner);
        if (modifier === undefined) {
            scanner.pos = save;
            break;
        }
        modifiers.push(modifier);
    }
    return { ...head, modifiers };
}
function parseCheck(scanner, onFail) {
    const start = scanner.pos;
    const fail = (reason) => {
        onFail?.(reason, scanner.pos);
        scanner.pos = start;
        return undefined;
    };
    if (!scanner.eat('['))
        return fail('no-open');
    /**
     * Brace depth is tracked so a quote inside a nested expression does not close
     * the branch, which is what allows conditionals to nest.
     */
    const branch = () => {
        if (!scanner.eat('"'))
            return undefined;
        let text = '';
        let depth = 0;
        while (!scanner.atEnd) {
            const char = scanner.peek();
            if (char === '\\' && scanner.peek(1) === '"') {
                text += '"';
                scanner.pos += 2;
                continue;
            }
            if (char === '{')
                depth += 1;
            else if (char === '}')
                depth = Math.max(0, depth - 1);
            else if (char === '"' && depth === 0) {
                scanner.pos += 1;
                return text;
            }
            text += char;
            scanner.pos += 1;
        }
        return undefined;
    };
    // `branch()` eats the opening `"`, so the content begins one past here
    const trueStart = scanner.pos + 1;
    const trueTemplate = branch();
    if (trueTemplate === undefined)
        return fail('true-branch');
    if (!scanner.eat('||'))
        return fail('missing-or');
    const falseStart = scanner.pos + 1;
    const falseTemplate = branch();
    if (falseTemplate === undefined)
        return fail('false-branch');
    // third branch distinguishes absent from false
    let absentTemplate;
    let absentStart;
    if (scanner.startsWith('||')) {
        scanner.pos += 2;
        absentStart = scanner.pos + 1;
        absentTemplate = branch();
        if (absentTemplate === undefined)
            return fail('absent-branch');
    }
    if (!scanner.eat(']'))
        return fail('missing-close');
    return {
        trueTemplate,
        falseTemplate,
        trueStart,
        falseStart,
        ...(absentTemplate !== undefined ? { absentTemplate, absentStart } : {}),
    };
}
/** Finds the matching `?}`, allowing groups to nest. */
function parseGroupBody(scanner) {
    const start = scanner.pos;
    if (!scanner.eat('{?'))
        return undefined;
    const from = scanner.pos;
    let depth = 1;
    while (!scanner.atEnd) {
        if (scanner.startsWith('{?')) {
            depth += 1;
            scanner.pos += 2;
            continue;
        }
        if (scanner.startsWith('?}')) {
            depth -= 1;
            if (depth === 0) {
                const body = scanner.slice(from);
                scanner.pos += 2;
                return body;
            }
            scanner.pos += 2;
            continue;
        }
        scanner.pos += 1;
    }
    scanner.pos = start;
    return undefined;
}
/** `{tools.newLine}` / `{tools.removeLine}`: layout directives, not values. */
function parseTool(scanner) {
    const start = scanner.pos;
    for (const tool of ['newLine', 'removeLine']) {
        if (scanner.eat(`{tools.${tool}}`))
            return { kind: 'tool', tool };
        scanner.pos = start;
    }
    return undefined;
}
/** Attempts one `{...}` at the scanner's position. */
function parseExpression(scanner) {
    const start = scanner.pos;
    const fail = () => {
        scanner.pos = start;
        return undefined;
    };
    if (!scanner.eat('{'))
        return fail();
    skipSpaces(scanner);
    const operands = [];
    const found = [];
    const first = parseOperand(scanner);
    if (!first)
        return fail();
    operands.push(first);
    while (scanner.startsWith('::')) {
        const save = scanner.pos;
        scanner.pos += 2;
        const comparator = comparators().find((name) => scanner.startsWith(`${name}::`));
        if (!comparator) {
            scanner.pos = save;
            break;
        }
        scanner.pos += comparator.length + 2;
        const operand = parseOperand(scanner);
        if (!operand)
            return fail();
        found.push(comparator.toLowerCase());
        operands.push(operand);
    }
    const check = scanner.peek() === '[' ? parseCheck(scanner) : undefined;
    skipSpaces(scanner);
    if (!scanner.eat('}'))
        return fail();
    return {
        kind: 'expression',
        source: scanner.slice(start),
        operands,
        comparators: found,
        start,
        end: scanner.pos,
        ...(check ? { check } : {}),
    };
}
/**
 * Shifts every node position (and each check branch start) by `delta`, so a
 * group body parsed as its own substring reports document-absolute offsets.
 */
function offsetNodes(nodes, delta) {
    for (const node of nodes) {
        if (node.start !== undefined)
            node.start += delta;
        if (node.end !== undefined)
            node.end += delta;
        if (node.kind === 'group')
            offsetNodes(node.nodes, delta);
        if (node.kind === 'expression' && node.check) {
            const c = node.check;
            if (c.trueStart !== undefined)
                c.trueStart += delta;
            if (c.falseStart !== undefined)
                c.falseStart += delta;
            if (c.absentStart !== undefined)
                c.absentStart += delta;
        }
    }
}
/** Never throws; unparseable spans render verbatim and are reported in `diagnostics`. */
export function parseTemplate(template) {
    const scanner = new Scanner(template);
    const nodes = [];
    const diagnostics = [];
    let literalStart = 0;
    /** End of the furthest span that has already failed; see NESTED_SAFE_CATEGORIES. */
    let recoveringUntil = 0;
    const flushLiteral = (end) => {
        if (end > literalStart) {
            const node = rawText(template.slice(literalStart, end));
            node.start = literalStart;
            node.end = end;
            nodes.push(node);
        }
    };
    while (!scanner.atEnd) {
        if (scanner.peek() !== '{') {
            scanner.pos += 1;
            continue;
        }
        const braceIndex = scanner.pos;
        if (scanner.startsWith('{?')) {
            const body = parseGroupBody(scanner);
            if (body !== undefined) {
                flushLiteral(braceIndex);
                const inner = parseTemplate(body);
                // `parseGroupBody` eats `{?` before capturing the body, so body offset 0
                // sits two characters in; nested groups compose by each adding its own
                const offset = braceIndex + 2;
                diagnostics.push(...inner.diagnostics.map((d) => ({ ...d, index: d.index + offset })));
                // re-base child offsets so every node position is in document coordinates
                offsetNodes(inner.nodes, offset);
                nodes.push({
                    kind: 'group',
                    nodes: inner.nodes,
                    start: braceIndex,
                    end: scanner.pos,
                });
                literalStart = scanner.pos;
                continue;
            }
            if (diagnostics.length < MAX_DIAGNOSTICS) {
                diagnostics.push({
                    index: braceIndex,
                    message: 'unterminated group: no matching `?}`',
                    source: template.slice(braceIndex, braceIndex + 2),
                    category: 'unterminated-group',
                });
            }
        }
        const node = parseTool(scanner) ?? parseExpression(scanner);
        if (!node) {
            const closing = template.indexOf('}', braceIndex);
            const inner = closing === -1 ? '' : template.slice(braceIndex + 1, closing);
            // Diagnosed over a brace-matched span, independently of the substitution
            // decision below. That decision governs rendered output and must not
            // change, so the two are deliberately kept apart.
            if (diagnostics.length < MAX_DIAGNOSTICS) {
                const diagnostic = diagnoseSpan(template, braceIndex);
                const nested = braceIndex < recoveringUntil;
                if (diagnostic &&
                    (!nested || NESTED_SAFE_CATEGORIES.has(diagnostic.category))) {
                    diagnostics.push(diagnostic);
                }
            }
            recoveringUntil = Math.max(recoveringUntil, matchBrace(template, braceIndex).end);
            // only substitute when the text was clearly meant as an expression, so
            // prose containing a stray brace stays prose. a nested `{` may still open
            // a valid expression, so leave it alone
            if (!inner.includes('{') && LOOKS_LIKE_EXPRESSION.test(inner)) {
                flushLiteral(braceIndex);
                nodes.push({
                    kind: 'raw',
                    text: `{invalid_expression(${inner.trim()})}`,
                    start: braceIndex,
                    end: closing + 1,
                });
                scanner.pos = closing + 1;
                literalStart = scanner.pos;
                continue;
            }
            scanner.pos = braceIndex + 1;
            continue;
        }
        flushLiteral(braceIndex);
        // tool nodes carry no position of their own; expressions already do
        if (node.start === undefined)
            node.start = braceIndex;
        if (node.end === undefined)
            node.end = scanner.pos;
        nodes.push(node);
        literalStart = scanner.pos;
    }
    flushLiteral(template.length);
    return { nodes, diagnostics };
}
// --------------------------------------------------------------- diagnostics
/** Example argument list per shape, so the message can show the fix. */
export const ARGUMENT_EXAMPLES = {
    quoted: "('text')",
    quotedPair: "('from', 'to')",
    quotedList: "('forced', 'lang=English')",
    replaceArgs: "('find', 'replaceWith')",
    digits: '(3)',
    digitsOrPair: '(0, 3)',
    loose: "('a', 'b')",
    template: '("{track.lang}")',
};
/** Extent of the `{...}` opening at `braceIndex`, matching nested braces. */
function matchBrace(template, braceIndex) {
    let depth = 0;
    const limit = Math.min(template.length, braceIndex + MAX_SPAN_SCAN);
    for (let i = braceIndex; i < limit; i++) {
        const char = template[i];
        if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0)
                return { end: i, terminated: true };
        }
    }
    return { end: limit, terminated: false };
}
/** Every modifier name the grammar accepts, for near-miss suggestions. */
function knownModifierNames() {
    return [
        ...new Set([...plainModifiers(), ...CALL_MODIFIERS.map(([name]) => name)]),
    ];
}
function isKnownModifier(token) {
    return knownModifierNames().includes(token.toLowerCase());
}
/**
 * Classifies an already-failed `{...}` span. Returns undefined when the span was
 * never expression-like, so prose is left alone.
 */
function diagnoseSpan(template, braceIndex) {
    const { end, terminated } = matchBrace(template, braceIndex);
    const source = template.slice(braceIndex, terminated ? end + 1 : end);
    const inner = terminated ? source.slice(1, -1) : source.slice(1);
    if (!LOOKS_LIKE_EXPRESSION.test(inner))
        return undefined;
    const at = (category, message, suggestion) => ({
        index: braceIndex,
        message,
        source,
        category,
        ...(suggestion ? { suggestion } : {}),
    });
    /**
     * `join` and `time` sit in both tables, so the call shape is checked first.
     */
    const badArguments = (token) => {
        const lower = token.toLowerCase();
        const call = CALL_MODIFIERS.find(([name]) => name === lower);
        return at('modifier-arguments', call
            ? `modifier \`${token}\` has invalid arguments; expected \`${lower}${ARGUMENT_EXAMPLES[call[1]]}\``
            : `modifier \`${token}\` takes no arguments`);
    };
    const scanner = new Scanner(source);
    scanner.eat('{');
    skipSpaces(scanner);
    /** An unknown field is the most common authoring error by far. */
    const checkHead = () => {
        const headStart = scanner.pos;
        while (isIdentifierChar(scanner.peek()))
            scanner.pos += 1;
        const section = scanner.slice(headStart);
        if (!section || scanner.peek() !== '.') {
            // quoted literal or malformed head; the modifier pass may still explain it
            scanner.pos = headStart;
            return undefined;
        }
        scanner.pos += 1;
        const propertyStart = scanner.pos;
        while (isIdentifierChar(scanner.peek()))
            scanner.pos += 1;
        const property = scanner.slice(propertyStart);
        if (!property || canonicaliseField(section, property))
            return undefined;
        const suggestions = suggestField(section, property);
        const hint = suggestions.length
            ? ` — did you mean \`${suggestions.join('` or `')}\`?`
            : '';
        return at('unknown-field', `unknown field \`${section}.${property}\`${hint}`, suggestions[0]);
    };
    const checkModifiers = () => {
        while (scanner.startsWith('::')) {
            const save = scanner.pos;
            scanner.pos += 2;
            // a comparator ends this operand rather than extending it
            if (comparators().some((c) => scanner.startsWith(`${c}::`))) {
                scanner.pos = save;
                return undefined;
            }
            const modifierStart = scanner.pos;
            if (parseModifier(scanner)) {
                // a plain modifier matches even when followed by `(`, leaving the
                // argument list dangling for `eat('}')` to choke on later
                if (scanner.peek() === '(') {
                    return badArguments(scanner.slice(modifierStart));
                }
                continue;
            }
            // prefix operators consume almost anything, so are never the culprit
            if (PREFIX_OPERATORS.some((operator) => scanner.startsWith(operator))) {
                scanner.pos = save;
                return undefined;
            }
            const tokenStart = scanner.pos;
            while (isIdentifierChar(scanner.peek()))
                scanner.pos += 1;
            const token = scanner.slice(tokenStart);
            if (!token)
                return undefined;
            if (isKnownModifier(token))
                return badArguments(token);
            const close = nearestName(token.toLowerCase(), knownModifierNames());
            return at('unknown-modifier', `unknown modifier \`${token}\`${close ? ` — did you mean \`${close}\`?` : ''}`);
        }
        return undefined;
    };
    // operands, separated by comparators, mirroring parseExpression
    for (;;) {
        const head = checkHead();
        if (head)
            return head;
        const modifier = checkModifiers();
        if (modifier)
            return modifier;
        if (!scanner.startsWith('::'))
            break;
        const save = scanner.pos;
        scanner.pos += 2;
        const comparator = comparators().find((c) => scanner.startsWith(`${c}::`));
        if (!comparator) {
            scanner.pos = save;
            break;
        }
        scanner.pos += comparator.length + 2;
    }
    // conditional, re-run the real grammar to find which part gave out
    if (scanner.peek() === '[') {
        let failure;
        parseCheck(scanner, (reason, position) => {
            failure ??= { reason, at: position };
        });
        if (failure) {
            const message = describeCheckFailure(source, failure.reason, failure.at);
            if (message)
                return at('conditional', message);
        }
    }
    if (!terminated) {
        return at('unterminated', 'unterminated expression: no closing `}`');
    }
    return at('unparseable', `unparseable expression: {${inner}}`);
}
/** Turns a `parseCheck` bail-out into something an author can act on. */
function describeCheckFailure(source, reason, at) {
    if (reason === 'no-open')
        return undefined;
    if (reason === 'missing-close') {
        return 'conditional is missing its closing `]`';
    }
    if (reason === 'missing-or') {
        return 'conditional branches must be separated by `||`';
    }
    if (at >= source.length) {
        return 'unterminated conditional branch: a nested `{` is missing its `}`, or the branch is missing its closing `"`';
    }
    if (source[at] === '\\' && source[at + 1] === '"') {
        return 'conditional branch starts with an escaped quote `\\"` — escapes only apply one nesting level deeper';
    }
    return 'conditional branch must start with `"`';
}
export function tokenize(template) {
    const out = [];
    tokenizeRegion(template, 0, template.length, IDENTITY, 0, out);
    out.sort((a, b) => a.start - b.start);
    return out;
}
const IDENTITY = (index) => index;
/** Pushes a token, translating its local `[from, to)` span into document coords. */
function pushToken(out, map, from, to, kind, depth) {
    if (to <= from)
        return;
    const start = map(from);
    const end = map(to - 1) + 1;
    if (end > start)
        out.push({ start, end, kind, depth });
}
/** `{tools.*}` extent at `index`, or undefined. Case-insensitive, like the parser. */
function matchToolSpan(template, index, to) {
    // compared lower-to-lower, so the literals here are already lower-cased
    for (const tool of ['{tools.newline}', '{tools.removeline}']) {
        const end = index + tool.length;
        if (end <= to && template.slice(index, end).toLowerCase() === tool)
            return end;
    }
    return undefined;
}
/** Matching `?}` for the `{?` at `index`, allowing nested groups. */
function matchGroupSpan(template, index, to) {
    let pos = index + 2;
    let depth = 1;
    while (pos < to) {
        if (template.startsWith('{?', pos)) {
            depth += 1;
            pos += 2;
            continue;
        }
        if (template.startsWith('?}', pos)) {
            depth -= 1;
            if (depth === 0)
                return { bodyEnd: pos, end: pos + 2 };
            pos += 2;
            continue;
        }
        pos += 1;
    }
    return undefined;
}
function tokenizeRegion(text, from, to, map, depth, out) {
    let pos = from;
    let textStart = from;
    const flush = (end) => pushToken(out, map, textStart, end, 'text', depth);
    while (pos < to) {
        if (text[pos] !== '{') {
            pos += 1;
            continue;
        }
        const braceIndex = pos;
        const toolEnd = matchToolSpan(text, braceIndex, to);
        if (toolEnd !== undefined) {
            flush(braceIndex);
            pushToken(out, map, braceIndex, toolEnd, 'tool', depth);
            pos = toolEnd;
            textStart = pos;
            continue;
        }
        if (text.startsWith('{?', braceIndex)) {
            const group = matchGroupSpan(text, braceIndex, to);
            if (group !== undefined) {
                flush(braceIndex);
                pushToken(out, map, braceIndex, braceIndex + 2, 'group-brace', depth);
                tokenizeRegion(text, braceIndex + 2, group.bodyEnd, map, depth + 1, out);
                pushToken(out, map, group.bodyEnd, group.end, 'group-brace', depth);
                pos = group.end;
                textStart = pos;
                continue;
            }
        }
        // the real grammar decides whether this is an expression and where it ends
        const probe = new Scanner(text, braceIndex);
        const node = parseExpression(probe);
        if (node && probe.pos <= to) {
            flush(braceIndex);
            tokenizeExpression(text, braceIndex, probe.pos, map, depth, out);
            pos = probe.pos;
            textStart = pos;
            continue;
        }
        // renders as literal text; labelled so an editor can dim a dead `{...}`
        flush(braceIndex);
        const matched = matchBrace(text, braceIndex);
        const invalidEnd = Math.min(matched.terminated ? matched.end + 1 : matched.end, to);
        if (invalidEnd > braceIndex) {
            pushToken(out, map, braceIndex, invalidEnd, 'invalid', depth);
            pos = invalidEnd;
        }
        else {
            pos = braceIndex + 1;
        }
        textStart = pos;
    }
    flush(to);
}
/** Labels an already-valid `{...}` at `[start, end)`. */
function tokenizeExpression(text, start, end, map, depth, out) {
    const scanner = new Scanner(text, start + 1);
    pushToken(out, map, start, start + 1, 'brace', depth);
    skipSpaces(scanner);
    tokenizeOperand(scanner, end, map, depth, out);
    while (scanner.pos < end && scanner.startsWith('::')) {
        const save = scanner.pos;
        scanner.pos += 2;
        const comparator = comparators().find((c) => scanner.startsWith(`${c}::`));
        if (!comparator) {
            scanner.pos = save;
            break;
        }
        const cStart = save + 2;
        pushToken(out, map, save, cStart, 'separator', depth);
        pushToken(out, map, cStart, cStart + comparator.length, 'comparator', depth);
        pushToken(out, map, cStart + comparator.length, cStart + comparator.length + 2, 'separator', depth);
        scanner.pos = cStart + comparator.length + 2;
        tokenizeOperand(scanner, end, map, depth, out);
    }
    if (scanner.pos < end && scanner.peek() === '[') {
        tokenizeCheck(scanner, end, map, depth, out);
    }
    // the region is known-valid, so its last character is the closing brace
    if (text[end - 1] === '}') {
        pushToken(out, map, end - 1, end, 'brace', depth);
    }
}
function tokenizeOperand(scanner, end, map, depth, out) {
    const lead = scanner.peek();
    if (lead === "'" || lead === '"') {
        const litStart = scanner.pos;
        scanner.pos += 1;
        while (scanner.pos < end && scanner.peek() !== lead)
            scanner.pos += 1;
        if (scanner.peek() === lead)
            scanner.pos += 1;
        pushToken(out, map, litStart, scanner.pos, 'literal', depth);
    }
    else {
        const secStart = scanner.pos;
        while (isIdentifierChar(scanner.peek()))
            scanner.pos += 1;
        pushToken(out, map, secStart, scanner.pos, 'section', depth);
        if (scanner.peek() === '.') {
            pushToken(out, map, scanner.pos, scanner.pos + 1, 'dot', depth);
            scanner.pos += 1;
            const propStart = scanner.pos;
            while (isIdentifierChar(scanner.peek()))
                scanner.pos += 1;
            pushToken(out, map, propStart, scanner.pos, 'property', depth);
        }
    }
    while (scanner.pos < end && scanner.startsWith('::')) {
        const save = scanner.pos;
        scanner.pos += 2;
        // a comparator terminates the operand rather than extending it
        if (comparators().some((cmp) => scanner.startsWith(`${cmp}::`))) {
            scanner.pos = save;
            break;
        }
        pushToken(out, map, save, save + 2, 'separator', depth);
        const before = scanner.pos;
        tokenizeModifier(scanner, map, depth, out);
        if (scanner.pos <= before)
            break;
    }
}
function tokenizeModifier(scanner, map, depth, out) {
    const start = scanner.pos;
    for (const [name, shape] of CALL_MODIFIERS) {
        if (!scanner.startsWith(`${name}(`))
            continue;
        const nameEnd = start + name.length;
        scanner.pos = nameEnd;
        const argStart = scanner.pos;
        if (scanCallArguments(scanner, shape)) {
            pushToken(out, map, start, nameEnd, 'modifier', depth);
            if (shape === 'template') {
                tokenizeTemplateArguments(scanner.input, argStart, scanner.pos, map, depth, out);
            }
            else {
                pushToken(out, map, argStart, scanner.pos, 'call-args', depth);
            }
            return;
        }
        scanner.pos = start;
        break;
    }
    for (const operator of PREFIX_OPERATORS) {
        if (!scanner.startsWith(operator))
            continue;
        const opEnd = start + operator.length;
        pushToken(out, map, start, opEnd, 'prefix-op', depth);
        scanner.pos = opEnd;
        const argStart = scanner.pos;
        scanPrefixArgument(scanner);
        pushToken(out, map, argStart, scanner.pos, 'call-args', depth);
        return;
    }
    for (const name of plainModifiers()) {
        if (!scanner.startsWith(name))
            continue;
        if (isIdentifierChar(scanner.peek(name.length)))
            continue;
        pushToken(out, map, start, start + name.length, 'modifier', depth);
        scanner.pos = start + name.length;
        return;
    }
}
function tokenizeTemplateArguments(text, from, to, map, depth, out) {
    let quoteAt = from + 1;
    while (/\s/.test(text[quoteAt] ?? ''))
        quoteAt += 1;
    const argument = scanTemplateArgument(text, quoteAt);
    if (!argument) {
        pushToken(out, map, from, to, 'call-args', depth);
        return;
    }
    const toText = templateArgumentMapper(argument);
    pushToken(out, map, from, quoteAt, 'call-args', depth);
    pushToken(out, map, quoteAt, quoteAt + 1, 'quote', depth);
    tokenizeRegion(argument.content, 0, argument.content.length, (i) => map(toText(i)), depth + 1, out);
    pushToken(out, map, argument.end - 1, argument.end, 'quote', depth);
    pushToken(out, map, argument.end, to, 'call-args', depth);
}
function tokenizeCheck(scanner, end, map, depth, out) {
    pushToken(out, map, scanner.pos, scanner.pos + 1, 'bracket', depth);
    scanner.pos += 1;
    for (let branch = 0; branch < 3; branch++) {
        tokenizeBranch(scanner, end, map, depth, out);
        if (!scanner.startsWith('||'))
            break;
        pushToken(out, map, scanner.pos, scanner.pos + 2, 'pipe', depth);
        scanner.pos += 2;
    }
    if (scanner.peek() === ']') {
        pushToken(out, map, scanner.pos, scanner.pos + 1, 'bracket', depth);
        scanner.pos += 1;
    }
}
function tokenizeBranch(scanner, end, map, depth, out) {
    if (scanner.peek() !== '"')
        return;
    pushToken(out, map, scanner.pos, scanner.pos + 1, 'quote', depth);
    scanner.pos += 1;
    // Rebuild the branch's UNESCAPED text (mirroring parseCheck's branch scan) and
    // a map from its indices back into `text`. Recursing on the unescaped string is
    // what lets a nested `[\"...\"||...]` conditional tokenise instead of falling
    // back to a dead span, since parseExpression only understands real quotes.
    let branchText = '';
    const localToText = [];
    let braceDepth = 0;
    while (scanner.pos < end) {
        const char = scanner.peek();
        if (char === '\\' && scanner.peek(1) === '"') {
            localToText.push(scanner.pos);
            branchText += '"';
            scanner.pos += 2;
            continue;
        }
        if (char === '{')
            braceDepth += 1;
        else if (char === '}')
            braceDepth = Math.max(0, braceDepth - 1);
        else if (char === '"' && braceDepth === 0)
            break;
        localToText.push(scanner.pos);
        branchText += char;
        scanner.pos += 1;
    }
    const contentEnd = scanner.pos;
    // branch-local index -> position in `text` -> document offset
    const branchMap = (i) => map(i >= 0 && i < localToText.length ? localToText[i] : contentEnd);
    tokenizeRegion(branchText, 0, branchText.length, branchMap, depth + 1, out);
    if (scanner.peek() === '"') {
        pushToken(out, map, contentEnd, contentEnd + 1, 'quote', depth);
        scanner.pos += 1;
    }
}
