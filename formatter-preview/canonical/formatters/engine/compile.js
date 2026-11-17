// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
import { eachTemplate, parseTemplate } from './parser.js';
import { MAX_RENDER_LENGTH, compileModifier, isObjectList, } from './modifiers.js';
import { NEW_LINE_SENTINEL, REMOVE_LINE_SENTINEL, hasSentinel, sanitise, } from './sentinels.js';
const MAX_TEMPLATE_DEPTH = 5;
/**
 * What the render in progress has left of `MAX_RENDER_LENGTH`.
 *
 * A render is synchronous from the outermost template down, so two of them can
 * never interleave on this.
 */
let renderBudget = MAX_RENDER_LENGTH;
// an item can render nothing, so the length budget alone would not bound each()
const MAX_EACH_RENDERS = 256;
let eachBudget = MAX_EACH_RENDERS;
/** Appends only while the budget lasts */
function emit(render, parseValue) {
    if (renderBudget <= 0)
        return '';
    const text = render(parseValue);
    renderBudget -= text.length;
    return text;
}
function prepareOperand(node, hooks, depth, inEach) {
    return {
        node,
        modifiers: node.modifiers.map((source) => ({
            source,
            apply: compileEach(source, hooks, depth, inEach) ?? compileModifier(source),
        })),
    };
}
function compileEach(source, hooks, depth, inEach) {
    const template = eachTemplate(source);
    if (!template)
        return undefined;
    // nesting would multiply the work per level
    if (inEach)
        return () => undefined;
    const render = compileTemplate(template.content, hooks, depth + 1, true);
    return (value, parseValue) => {
        if (!Array.isArray(value))
            return undefined;
        if (value.length && !isObjectList(value))
            return undefined;
        const out = [];
        let length = 0;
        for (const track of value) {
            if (eachBudget <= 0 || length >= MAX_RENDER_LENGTH)
                break;
            eachBudget -= 1;
            const text = render({ ...parseValue, track });
            length += text.length;
            if (/\S/.test(text))
                out.push(text);
        }
        return out;
    };
}
function modifierContext(parseValue, hooks) {
    return {
        resolveVariable: (source) => hooks.resolveVariable(source, parseValue),
        resolveValues: (source) => hooks.resolveValues(source, parseValue),
    };
}
function resolveOperand(operand, parseValue, hooks) {
    if (operand.node.literal !== undefined) {
        const ctx = modifierContext(parseValue, hooks);
        let value = operand.node.literal;
        for (const { apply } of operand.modifiers) {
            const next = apply(value, parseValue, ctx);
            if (next === undefined)
                break;
            value = next;
            if (typeof value === 'string' && value.length > MAX_RENDER_LENGTH) {
                value = value.slice(0, MAX_RENDER_LENGTH);
                break;
            }
        }
        return { result: value, present: true };
    }
    const section = parseValue[operand.node.section];
    if (!section) {
        return { error: `{unknown_variableType(${operand.node.section})}` };
    }
    const property = section[operand.node.property];
    if (property === undefined) {
        return {
            error: `{unknown_propertyName(${operand.node.section}.${operand.node.property})}`,
        };
    }
    const ctx = modifierContext(parseValue, hooks);
    // Scrub sentinels as the value enters, so stream data can never forge a
    // layout directive. Anything a modifier adds afterwards is template-authored
    // and therefore trusted.
    let result = property;
    if (typeof property === 'string') {
        result = sanitise(property);
    }
    else if (Array.isArray(property) &&
        property.some((item) => typeof item === 'string' && hasSentinel(item))) {
        result = property.map((item) => typeof item === 'string' ? sanitise(item) : item);
    }
    const present = isPresent(property) ||
        operand.modifiers.some(({ source }) => source.toLowerCase().startsWith('default('));
    for (const { source, apply } of operand.modifiers) {
        // the value this modifier is applied to, which a preceding modifier may
        // already have changed the type of
        const input = result;
        result = apply(input, parseValue, ctx);
        if (result !== undefined) {
            // a single modifier can multiply its input, so the chain is bounded as it
            // runs and not once it has already built the string
            if (typeof result === 'string' && result.length > MAX_RENDER_LENGTH) {
                result = result.slice(0, MAX_RENDER_LENGTH);
                break;
            }
            continue;
        }
        // a modifier on an absent value renders nothing
        if (input === null || input === undefined)
            return { result: '', present };
        return {
            error: `{unknown_${Array.isArray(input) ? 'array' : typeof input}_modifier(${source})}`,
        };
    }
    if (isObjectList(result)) {
        return {
            error: `{unrenderable_list(${operand.node.section}.${operand.node.property})}`,
        };
    }
    return { result, present };
}
function resolveExpression(node, operands, parseValue, hooks) {
    if (operands.length === 1) {
        return resolveOperand(operands[0], parseValue, hooks);
    }
    let present = operandPresence(operands[0]);
    for (let i = 1; i < operands.length; i++) {
        const next = operandPresence(operands[i]);
        present =
            node.comparators[i - 1] === 'or' ? present || next : present && next;
    }
    // mixing operators makes left-to-right evaluation order observable,
    // so short-circuiting is limited to uniform and/or chains, and a skipped tail operand is never resolved.
    const allSame = node.comparators.every((c) => c === node.comparators[0]);
    const canShortCircuit = allSame && (node.comparators[0] === 'and' || node.comparators[0] === 'or');
    let result = resolveOperand(operands[0], parseValue, hooks);
    for (let i = 1; i < operands.length; i++) {
        if (result.error !== undefined)
            return result;
        const comparator = node.comparators[i - 1];
        if (canShortCircuit) {
            if (comparator === 'and' && result.result === false)
                return { result: false, present };
            if (comparator === 'or' && result.result === true)
                return { result: true, present };
        }
        const next = resolveOperand(operands[i], parseValue, hooks);
        if (next.error !== undefined)
            return next;
        try {
            result = {
                result: hooks.comparators[comparator](result.result, next.result),
            };
        }
        catch (error) {
            return {
                error: `{unable_to_compare(<${result.result}>::${comparator}::<${next.result}>, ${error})}`,
            };
        }
    }
    return { result: result.result, present };
    function operandPresence(operand) {
        if (operand.node.literal !== undefined)
            return true;
        // default() supplies a value for an absent field, so the operand is present
        if (operand.modifiers.some(({ source }) => source.toLowerCase().startsWith('default(')))
            return true;
        const section = parseValue[operand.node.section];
        return section ? isPresent(section[operand.node.property]) : false;
    }
}
function compileNode(node, hooks, depth, inEach) {
    if (node.kind === 'raw') {
        // resolved per literal, so a value containing a backslash-n is untouched
        const text = node.text.replace(/\\n/g, '\n');
        return () => text;
    }
    if (node.kind === 'tool') {
        const sentinel = node.tool === 'newLine' ? NEW_LINE_SENTINEL : REMOVE_LINE_SENTINEL;
        return () => sentinel;
    }
    if (node.kind === 'group')
        return compileGroup(node, hooks, depth, inEach);
    const operands = node.operands.map((operand) => prepareOperand(operand, hooks, depth, inEach));
    if (!node.check) {
        return (parseValue) => {
            const resolved = resolveExpression(node, operands, parseValue, hooks);
            return resolved.error ?? String(resolved.result ?? '');
        };
    }
    const branch = (template) => compileTemplate(template, hooks, depth + 1, inEach);
    const whenTrue = branch(node.check.trueTemplate);
    const whenFalse = branch(node.check.falseTemplate);
    const whenAbsent = node.check.absentTemplate === undefined
        ? undefined
        : branch(node.check.absentTemplate);
    return (parseValue) => {
        const resolved = resolveExpression(node, operands, parseValue, hooks);
        if (resolved.error !== undefined)
            return resolved.error;
        if (!isPresent(resolved.result)) {
            // absent renders nothing unless a third branch says otherwise; a present
            // value that is not a boolean is an authoring error worth surfacing
            return whenAbsent ? whenAbsent(parseValue) : '';
        }
        if (resolved.result !== true && resolved.result !== false) {
            return `{cannot_coerce_boolean_for_check_from(${resolved.result})}`;
        }
        return resolved.result ? whenTrue(parseValue) : whenFalse(parseValue);
    };
}
/** Same notion of presence as `::exists`, so the two never disagree. */
function isPresent(value) {
    if (value === undefined || value === null)
        return false;
    if (typeof value === 'string')
        return /\S/.test(value);
    if (Array.isArray(value))
        return value.length > 0;
    return true;
}
/** Renders only when every expression inside resolved to a present value. */
function compileGroup(node, hooks, depth, inEach) {
    const parts = node.nodes.map((child) => ({
        node: child,
        render: compileNode(child, hooks, depth, inEach),
        // a check produces output either way, so it never suppresses the group
        operands: child.kind === 'expression' && !child.check
            ? child.operands.map((operand) => prepareOperand(operand, hooks, depth, inEach))
            : undefined,
    }));
    return (parseValue) => {
        let out = '';
        for (const { node: child, render, operands } of parts) {
            if (operands) {
                const resolved = resolveExpression(child, operands, parseValue, hooks);
                if (resolved.error === undefined && resolved.present === false)
                    return '';
            }
            out += emit(render, parseValue);
        }
        return out;
    };
}
/**
 * Resolves a single expression against a value, unlike `compileTemplate` which
 * renders a whole template. `result` is the computed value before stringifying.
 */
export function evaluateExpression(node, parseValue, hooks) {
    const operands = node.operands.map((operand) => prepareOperand(operand, hooks, 0, false));
    eachBudget = MAX_EACH_RENDERS;
    return resolveExpression(node, operands, parseValue, hooks);
}
/** The `{tools.*}` post-pass is a whole-output concern, left to the caller. */
export function compileTemplate(template, hooks, depth = 0, inEach = false) {
    if (depth > MAX_TEMPLATE_DEPTH) {
        hooks.onDepthExceeded?.(MAX_TEMPLATE_DEPTH);
        return () => template;
    }
    let source = template;
    for (const [key, replacement] of Object.entries(hooks.debugMacros ?? {})) {
        source = source.replace(`{debug.${key}}`, replacement);
    }
    const { nodes } = parseTemplate(source);
    const compiled = nodes.map((node) => compileNode(node, hooks, depth, inEach));
    const render = compiled.length === 1
        ? compiled[0]
        : (parseValue) => {
            let out = '';
            for (const part of compiled)
                out += emit(part, parseValue);
            return out;
        };
    // the outermost template owns the budget; the branch templates compiled
    // beneath it spend what is left rather than starting again
    if (depth > 0)
        return render;
    return (parseValue) => {
        renderBudget = MAX_RENDER_LENGTH;
        eachBudget = MAX_EACH_RENDERS;
        return render(parseValue);
    };
}
