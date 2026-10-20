'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, symbolAt, referencesTo } = require('../src/language');

const canonical = (body, state = 'ready', version = '0.2') => `plainlogic ${version}\nunit Example\nstate ${state}\nintent "An example."\nscope "Only the example."\nrequire R1 "Return a result."\n${body}`;
const byName = (model, name) => model.symbols.find(symbol => symbol.name === name);

test('routine locals and parameters are scoped and cannot rename a second routine', () => {
    const model = analyze(`fn first(value: Int) -> Int:\n    total = value\n    return total\n\nfn second(value: Int) -> Int:\n    total = value\n    return total\n`);
    const totals = model.symbols.filter(symbol => symbol.name === 'total');
    const values = model.symbols.filter(symbol => symbol.name === 'value');
    assert.equal(totals.length, 2);
    assert.equal(values.length, 2);
    assert.deepEqual(referencesTo(model, totals[0]).map(item => item.line), [1, 2]);
    assert.deepEqual(referencesTo(model, totals[1]).map(item => item.line), [5, 6]);
    assert.deepEqual(referencesTo(model, values[0]).map(item => item.line), [0, 1]);
    assert.equal(symbolAt(model, 6, 12).id, totals[1].id);
    assert.deepEqual(model.diagnostics, []);
});

test('strings, comments, prose, member names, and named arguments do not produce unsafe references', () => {
    const model = analyze(`record Thing:\n    value: Int\n\nfn show(value: Int) -> Thing:\n    # value is only commentary\n    > Return value with the caller's formatting, # intact.\n    text = "value # Thing"\n    escaped = 'value \\' Thing'\n    result = Thing(value=value)\n    return result.value\n`);
    const value = model.symbols.find(symbol => symbol.name === 'value' && symbol.kind === 'parameter');
    assert.deepEqual(referencesTo(model, value).map(item => [item.line, item.start]), [[3, 8], [8, 25]]);
    assert.equal(model.occurrences.filter(item => [4, 5].includes(item.line)).length, 0);
    assert.equal(model.occurrences.some(item => item.line === 9 && item.name === 'value'), false);
    const field = model.symbols.find(symbol => symbol.name === 'value' && symbol.kind === 'field');
    assert.equal(referencesTo(model, field).length, 1);
    assert.deepEqual(model.diagnostics, []);
});

test('the original return-first HTTP example is indexed as an informal fragment', () => {
    const model = analyze(`function JSONString executeRequest(string url, enum requestType [GET, POST, DELETE, PUT], object requestBody):\n     > Initialize http client\n     > Serialize requestBody\n     > Send request\n     > Return result as serialized JSON string\n`);
    assert.equal(model.isCanonical, false);
    assert.equal(byName(model, 'executeRequest').kind, 'fn');
    assert.deepEqual(model.symbols.filter(symbol => symbol.kind === 'parameter').map(symbol => symbol.name), ['url', 'requestType', 'requestBody']);
    assert.equal(model.occurrences.some(item => item.name === 'GET'), false);
    assert.deepEqual(model.diagnostics, []);
    assert.deepEqual(model.folds[0], { start: 0, end: 4, kind: 'region' });
});

test('informal collection types and a function matching its return type retain correct name offsets', () => {
    const source = 'type Result = Text\nfunction Result Result(List[Int] values, string[] labels):\n    return values';
    const model = analyze(source);
    const routine = model.symbols.find(symbol => symbol.kind === 'fn');
    assert.equal(model.lines[1].slice(routine.start, routine.end), 'Result');
    assert.equal(routine.start, 'function Result '.length);
    assert.deepEqual(model.symbols.filter(symbol => symbol.kind === 'parameter').map(symbol => symbol.name), ['values', 'labels']);
    assert.equal(referencesTo(model, byName(model, 'values')).length, 2);
});

test('duplicate parameters are not assigned a guessed binding or global fallback', () => {
    const model = analyze('type value = Int\nfn run(value: Int, value: Int) -> Int:\n    return value');
    assert.ok(model.diagnostics.some(item => item.code === 'duplicate-parameter'));
    assert.equal(symbolAt(model, 2, 12), undefined);
});

test('a local named like a primitive function is still a lexical binding', () => {
    const model = analyze('fn limit(max: Int) -> Int:\n    return max');
    assert.deepEqual(referencesTo(model, byName(model, 'max')).map(item => item.line), [0, 1]);
});

test('numeric literal suffixes cannot become definitions or rename references', () => {
    const model = analyze('fn xFF() -> Int:\n    return 0xFF\nfn e3() -> Int:\n    return 1e3 + 1.5e3 + 1e-3\nfn b101() -> Int:\n    return 0b101\nfn use() -> Int:\n    return xFF() + e3() + b101()');
    assert.deepEqual(referencesTo(model, byName(model, 'xFF')).map(item => item.line), [0, 7]);
    assert.deepEqual(referencesTo(model, byName(model, 'e3')).map(item => item.line), [2, 7]);
    assert.deepEqual(referencesTo(model, byName(model, 'b101')).map(item => item.line), [4, 7]);
    assert.equal(model.occurrences.some(item => [1, 3, 5].includes(item.line)), false);
});

test('unsupported Unicode identifiers cannot become partial ASCII rename references', () => {
    const model = analyze('fn caf() -> Int:\n    return café + écaf + caf́ + caf');
    const references = referencesTo(model, byName(model, 'caf'));
    assert.equal(references.length, 2);
    assert.equal(references[1].start, model.lines[1].lastIndexOf('caf'));
    assert.equal(references[1].end, model.lines[1].length);
});

test('metadata references navigate to the declared requirement, reference, and question', () => {
    const model = analyze(canonical(`ref repository "src/repository.py#load"\nopen Q1 "Which result?"\nport load() -> Int:\n    effect read\n    contract "Preserve repository behavior."\n    bind repository\n\nfn run() -> Int:\n    covers R1\n    ask Q1\n`, 'draft'));
    for (const [name, expected] of [['R1', 'require'], ['repository', 'ref'], ['Q1', 'open']]) {
        const symbol = byName(model, name);
        assert.equal(symbol.kind, expected);
        assert.equal(referencesTo(model, symbol).length, 2);
    }
    assert.deepEqual(model.diagnostics, []);
    assert.equal(byName(model, 'load').description, 'Preserve repository behavior.');
});

test('only explicit metadata links emit unresolved or wrong-kind reference diagnostics', () => {
    const model = analyze(`require R1 "A rule."\nref source "somewhere"\nfn run() -> Int:\n    covers source, Missing\n    bind R1\n    ask Q1\n    unknown = unknown_call(unknown_argument)\n    return unknown\n`);
    assert.deepEqual(model.diagnostics.filter(item => item.code === 'wrong-reference-kind').map(item => item.line), [3, 4]);
    assert.deepEqual(model.diagnostics.filter(item => item.code === 'unresolved-reference').map(item => item.line), [3, 5]);
    assert.equal(model.diagnostics.some(item => item.line === 6), false);
});

test('duplicate top names stay ambiguous for navigation and reference resolution', () => {
    const model = analyze('require R1 "One."\nrequire R1 "Two."\nfn run() -> Int:\n    covers R1\n    return 1');
    assert.equal(model.diagnostics.filter(item => item.code === 'duplicate-declaration').length, 1);
    assert.equal(model.diagnostics.filter(item => item.code === 'ambiguous-reference').length, 1);
    assert.equal(symbolAt(model, 3, 12), undefined);
});

test('ready requires coverage and resolution of open/ask, while a draft remains valid', () => {
    const body = 'open Q1 "Choose."\nrequire R2 "Another rule."\nfn run() -> Int:\n    covers R1\n    ask Q1';
    const ready = analyze(canonical(body));
    assert.deepEqual(ready.diagnostics.map(item => item.code).sort(), ['ready-ask', 'ready-open', 'uncovered-requirement']);
    assert.deepEqual(analyze(canonical(body, 'draft')).diagnostics, []);
});

test('prose blocks fold and remain opaque even with quotes, hashes, and precise nested logic', () => {
    const model = analyze(canonical(`fn run(values: List[Int]) -> Int:\n    covers R1\n    total = 0\n    > For each value in values:\n        if value > 0:\n            > Add value to total; don't treat # as a comment.\n    return total\n    # trailing explanation\n`));
    assert.deepEqual(model.folds, [{ start: 6, end: 13, kind: 'region' }, { start: 9, end: 11, kind: 'region' }, { start: 10, end: 11, kind: 'region' }]);
    assert.equal(model.symbols.some(symbol => symbol.name === 'value'), false);
    assert.deepEqual(model.diagnostics, []);
});

test('structural diagnostics flag tabs, jumps, empty blocks, and legacy prose', () => {
    const model = analyze(canonical('fn run() -> Int:\n    covers R1\n    if True:\n            > Too much indentation\n    else:\n    return 1\n\treturn 2', 'draft', '0.1'));
    const codes = model.diagnostics.map(item => item.code);
    assert.ok(codes.includes('indent-jump'));
    assert.ok(codes.includes('empty-block'));
    assert.ok(codes.includes('tabs'));
    assert.ok(codes.includes('legacy-prose'));
});

test('record type annotations and routine annotations link types independently of shadowed values', () => {
    const model = analyze(`record Result:\n    item: Int\nfn first(Result: Result) -> Result:\n    return Result\nfn second() -> Result:\n    return Result(item=1)`);
    const record = byName(model, 'Result');
    const parameter = model.symbols.find(symbol => symbol.name === 'Result' && symbol.kind === 'parameter');
    assert.deepEqual(referencesTo(model, record).map(item => item.line), [0, 2, 2, 4, 5]);
    assert.deepEqual(referencesTo(model, parameter).map(item => item.line), [2, 3]);
});

test('cases and loop bindings have their own scope and repeated assignments keep one local declaration', () => {
    const model = analyze(`fn count(values: List[Int]) -> Int:\n    total = 0\n    for value in values:\n        total = total + value\n    return total\ncase sample:\n    given value = 2\n    expect count([value]) == 1`);
    assert.equal(model.symbols.filter(symbol => symbol.name === 'total').length, 1);
    const locals = model.symbols.filter(symbol => symbol.name === 'value');
    assert.deepEqual(referencesTo(model, locals[0]).map(item => item.line), [2, 3]);
    assert.deepEqual(referencesTo(model, locals[1]).map(item => item.line), [6, 7]);
});

test('short loop and given names use capture positions rather than matching inside keywords', () => {
    const model = analyze('fn run(items: List[Int]) -> Int:\n    for r in items:\n        return r\ncase example:\n    given n = 2\n    expect run([n]) == 2');
    const loopVariable = byName(model, 'r');
    const givenVariable = byName(model, 'n');
    assert.equal(loopVariable.start, 8);
    assert.equal(givenVariable.start, 10);
    assert.equal(model.lines[loopVariable.line].slice(loopVariable.start, loopVariable.end), 'r');
    assert.equal(model.lines[givenVariable.line].slice(givenVariable.start, givenVariable.end), 'n');
    assert.deepEqual(referencesTo(model, loopVariable).map(item => [item.line, item.start, item.declaration]), [[1, 8, true], [2, 15, false]]);
    assert.deepEqual(referencesTo(model, givenVariable).map(item => [item.line, item.start, item.declaration]), [[4, 10, true], [5, 16, false]]);
});

test('empty snippets and prose-only drafts never acquire canonical document requirements', () => {
    assert.deepEqual(analyze('').diagnostics, []);
    assert.deepEqual(analyze('> Describe a function\n> Return a result').diagnostics, []);
    const canonicalModel = analyze('plainlogic 0.2');
    assert.ok(canonicalModel.diagnostics.some(item => item.code === 'missing-unit'));
    assert.ok(canonicalModel.diagnostics.some(item => item.code === 'missing-function'));
});
