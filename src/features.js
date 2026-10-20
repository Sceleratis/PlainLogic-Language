'use strict';

const keywords = {
    plainlogic: 'Canonical document language version: 0.1, 0.2, or 0.3.',
    unit: 'The name of a canonical document.',
    state: 'draft preserves open decisions; ready describes an implementable slice. Neither is an approval.',
    intent: 'The observable outcome of this slice.',
    scope: 'The behavior boundary of this slice.',
    target: 'Optional descriptive language/runtime context. It never selects or executes a tool.',
    alias: 'A document-local named English behavior that takes an indented body. Scheduling, capture, and control flow require semantic review.',
    native: 'A protected literal target-code block with a four-space container margin. Content is not executed, indexed, or renamed.',
    require: 'A named requirement. Connect it to routines with covers.',
    ref: 'A source lookup hint. Its existence and meaning still need verification.',
    open: 'A named unresolved decision. Keep its document in draft state.',
    type: 'A symbolic type alias, independent of the target language.',
    record: 'A named set of typed fields.',
    fn: 'A canonical routine. Its first entry is covers followed by logic, prose, or both.',
    function: 'An informal return-first function signature. Canonical document metadata is optional for fragments.',
    port: 'A reusable outside-operation contract with effect, contract, and optional bind.',
    case: 'A reviewable scenario and candidate test; it is not executed by the extension.',
    covers: 'Requirement IDs implemented by this routine or declared top-level alias/native behavior.',
    bind: 'The declared ref that describes a port implementation lookup.',
    ask: 'An open decision at the point it blocks logic. It is not a runtime placeholder.',
    effect: 'Port effects: pure, read, write, external. Effects do not grant execution permission.',
    contract: 'A port outcome, state effects, and failure behavior.',
    given: 'Scenario-local input data.',
    stub: 'A reviewable port result for a scenario; nothing is executed.',
    expect: 'A scenario assertion to verify in target code.',
    if: 'Execute the indented block when the condition holds.',
    elif: 'An alternative exact condition.',
    else: 'The alternative block of the associated branch.',
    for: 'Visit items in order, or count upward by one from first to last inclusive. Counted bounds are evaluated once; first > last gives zero iterations.',
    to: 'The inclusive upper bound in for name = first to last:. Bounds must be integers; target numeric compatibility requires validation.',
    while: 'Repeat while the condition holds. Review termination when it matters.',
    break: 'Leave the enclosing loop; a prose loop target needs semantic validation.',
    continue: 'Continue the enclosing loop; a prose loop target needs semantic validation.',
    return: 'Exit the routine with the given value.',
    raise: 'Propagate the specified error.',
    try: 'A block with explicit error handling or cleanup.',
    except: 'Handle a named error type.',
    finally: 'Cleanup after the associated try block.',
    await: 'Wait for a call inside an async routine. This does not imply concurrency.',
    async: 'An operation that may be awaited.',
    '>': 'An ordered English behavior step. A trailing colon opens a nested block. Its meaning requires semantic review.'
};
const types = ['Text', 'Int', 'Decimal', 'Bool', 'List', 'Map', 'Set', 'None'];
const primitives = ['len', 'min', 'max', 'sum', 'abs', 'sorted', 'range'];
const reserved = new Set([...Object.keys(keywords), ...types, ...primitives,
    'True', 'False', 'draft', 'ready', 'and', 'or', 'not', 'in', 'is', 'as',
    'pure', 'read', 'write', 'external', 'enum', 'returns']);

/** New 0.3 words remain legal identifiers in legacy canonical documents. */
function isReserved(name, version) {
    return reserved.has(name) && (!['0.1', '0.2'].includes(version) || !['alias', 'native', 'target', 'to'].includes(name));
}

/** True only outside a quoted string, comment, or English step. */
function isCodePosition(line, column) {
    if (line.trimStart().startsWith('>')) return false;
    const alias = /^\s*alias\s+[A-Za-z_]\w*\s*->/.exec(line);
    if (alias && column >= alias[0].length) return false;
    let quote = '';
    let escaped = false;
    for (let i = 0; i < Math.min(column, line.length); i++) {
        const c = line[i];
        if (escaped) { escaped = false; continue; }
        if (quote && c === '\\') { escaped = true; continue; }
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '#') return false;
        if (c === '"' || c === "'") quote = c;
    }
    return !quote;
}

/** Find the innermost named call and active positional slot without reading prose. */
function callAt(prefix) {
    if (!isCodePosition(prefix, prefix.length)) return undefined;
    const stack = [];
    let quote = '';
    let escaped = false;
    for (let i = 0; i < prefix.length; i++) {
        const c = prefix[i];
        if (escaped) { escaped = false; continue; }
        if (quote && c === '\\') { escaped = true; continue; }
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '#') break;
        if ('([{'.includes(c)) {
            const match = c === '(' && /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(prefix.slice(0, i));
            const member = match && prefix.slice(0, match.index).trimEnd().endsWith('.');
            stack.push({ opener: c, name: match && !member ? match[1] : undefined, index: 0,
                start: match ? match.index : undefined });
        } else if (')]}'.includes(c)) {
            stack.pop();
        } else if (c === ',' && stack.length) {
            stack[stack.length - 1].index++;
        }
    }
    return [...stack].reverse().find(item => item.name);
}

/** Relative file refs are navigation hints only; never interpret commands or URLs. */
function localRef(line) {
    const match = /^ref\s+[A-Za-z_][A-Za-z0-9_]*\s+(["'])(.*?)\1\s*(?:#.*)?$/.exec(line);
    if (!match) return undefined;
    const value = match[2];
    if (!value || value.includes('\\') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
        value.startsWith('/') || value.startsWith('~') || /[?*\0]/.test(value)) return undefined;
    const file = value.split('#')[0];
    if (!file || !/[./]/.test(file)) return undefined;
    const start = line.indexOf(match[1], line.indexOf('ref') + 3) + 1;
    return { path: file, start, end: start + value.length };
}

module.exports = { keywords, types, primitives, reserved, isReserved, isCodePosition, callAt, localRef };
