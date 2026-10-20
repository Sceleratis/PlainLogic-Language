'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { Registry, INITIAL, parseRawGrammar } = require('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma');

let grammar;

before(async () => {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const grammarPath = path.join(__dirname, '..', 'syntaxes', 'plainlogic.tmLanguage.json');
    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner: patterns => new OnigScanner(patterns),
            createOnigString: value => new OnigString(value)
        }),
        loadGrammar: async scope => scope === 'source.plainlogic'
            ? parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath)
            : null
    });
    grammar = await registry.loadGrammar('source.plainlogic');
    assert.ok(grammar, 'the actual TextMate grammar must load');
});

function tokenize(lines) {
    let state = INITIAL;
    return lines.map(line => {
        const result = grammar.tokenizeLine(line, state);
        state = result.ruleStack;
        return result.tokens.map(token => ({ ...token, text: line.slice(token.startIndex, token.endIndex) }));
    });
}

function scopesAt(line, tokens, text, occurrence = 0) {
    let index = -1;
    for (let count = 0; count <= occurrence; count++) {
        index = line.indexOf(text, index + 1);
        assert.notEqual(index, -1, `fixture contains ${text}`);
    }
    return tokens.find(token => token.startIndex <= index && token.endIndex > index)?.scopes ?? [];
}

function hasScope(line, tokens, text, scope, occurrence = 0) {
    assert.ok(scopesAt(line, tokens, text, occurrence).includes(scope), `${text} should have scope ${scope}`);
}

test('prose remains opaque around quotes, hashes, Unicode, and comparison-looking text', () => {
    const lines = [
        '    > If value > 0, keep #part and an unmatched "quote — café:',
        "        > Use 'single quotes', fn fake(), True, and value <= 10 literally.",
        '    >Without a space still describes prose.',
        '    return 42 # actual comment'
    ];
    const tokens = tokenize(lines);
    for (const row of tokens.slice(0, 3)) {
        assert.ok(row.every(token => token.scopes.includes('string.unquoted.prose.plainlogic')));
        assert.ok(row.every(token => !token.scopes.some(scope => /^(comment\.|string\.quoted\.|keyword\.|entity\.name\.function)/.test(scope))));
    }
    hasScope(lines[0], tokens[0], '>', 'punctuation.definition.prose.plainlogic');
    hasScope(lines[3], tokens[3], 'return', 'keyword.control.plainlogic');
    hasScope(lines[3], tokens[3], '# actual', 'comment.line.number-sign.plainlogic');
});

test('canonical function signatures distinguish names, parameters, and nested types', () => {
    const line = 'fn lookup(values: Map[Text, List[Int]]) -> Int | None:';
    const [tokens] = tokenize([line]);
    hasScope(line, tokens, 'fn', 'keyword.other.declaration.plainlogic');
    hasScope(line, tokens, 'lookup', 'entity.name.function.plainlogic');
    hasScope(line, tokens, 'values', 'variable.parameter.plainlogic');
    for (const name of ['Map', 'Text', 'List', 'Int', 'None']) {
        hasScope(line, tokens, name, 'support.type.plainlogic');
    }
    hasScope(line, tokens, '->', 'keyword.operator.plainlogic');
    hasScope(line, tokens, '|', 'keyword.operator.plainlogic');
});

test('async ports highlight modifiers, symbolic types, and normal body metadata', () => {
    const lines = [
        'async port load_order(id: OrderId) -> Order | None:',
        '    effect read, external',
        '    contract "Preserve the referenced contract."',
        '    bind orders_get'
    ];
    const tokens = tokenize(lines);
    hasScope(lines[0], tokens[0], 'async', 'storage.modifier.async.plainlogic');
    hasScope(lines[0], tokens[0], 'port', 'keyword.other.declaration.plainlogic');
    hasScope(lines[0], tokens[0], 'load_order', 'entity.name.function.plainlogic');
    hasScope(lines[0], tokens[0], 'OrderId', 'entity.name.type.plainlogic');
    hasScope(lines[1], tokens[1], 'external', 'storage.modifier.effect.plainlogic');
    hasScope(lines[2], tokens[2], '"Preserve', 'string.quoted.double.plainlogic');
    hasScope(lines[3], tokens[3], 'orders_get', 'variable.other.reference.source.plainlogic');
});

test('the user return-first function highlights its type, parameters, and inline enum', () => {
    const line = 'function JSONString executeRequest(string url, enum requestType [GET, POST, DELETE, PUT], object requestBody):';
    const [tokens] = tokenize([line]);
    hasScope(line, tokens, 'function', 'keyword.other.declaration.plainlogic');
    hasScope(line, tokens, 'JSONString', 'entity.name.type.plainlogic');
    hasScope(line, tokens, 'executeRequest', 'entity.name.function.plainlogic');
    for (const name of ['url', 'requestType', 'requestBody']) {
        hasScope(line, tokens, name, 'variable.parameter.plainlogic');
    }
    hasScope(line, tokens, 'enum', 'storage.type.enum.plainlogic');
    for (const name of ['GET', 'POST', 'DELETE', 'PUT']) {
        hasScope(line, tokens, name, 'constant.other.enum.plainlogic');
    }
});

test('informal methods may indent and signatures do not leak into their bodies', () => {
    const lines = [
        '    function Output perform(Input input):',
        '        > Return the result.',
        'fn next(value: Int) -> Int:',
        '    return value'
    ];
    const tokens = tokenize(lines);
    hasScope(lines[0], tokens[0], 'perform', 'entity.name.function.plainlogic');
    hasScope(lines[1], tokens[1], 'Return', 'string.unquoted.prose.plainlogic');
    hasScope(lines[2], tokens[2], 'next', 'entity.name.function.plainlogic');
    assert.ok(!tokens[3].some(token => token.scopes.some(scope => scope.startsWith('meta.function.signature'))));
});

test('indented canonical declarations are not styled as valid top-level declarations', () => {
    const lines = ['    fn nested(value: Int) -> Int:', '    port nested_port() -> Text:'];
    for (const tokens of tokenize(lines)) {
        assert.ok(!tokens.some(token => token.scopes.includes('entity.name.function.plainlogic')));
        assert.ok(!tokens.some(token => token.scopes.includes('keyword.other.declaration.plainlogic')));
    }
});

test('hard-logic strings protect hashes while trailing hashes become comments', () => {
    const line = '    return "a # literal" # a comment';
    const [tokens] = tokenize([line]);
    hasScope(line, tokens, '# literal', 'string.quoted.double.plainlogic');
    assert.ok(!scopesAt(line, tokens, '# literal').includes('comment.line.number-sign.plainlogic'));
    hasScope(line, tokens, '# a comment', 'comment.line.number-sign.plainlogic');
});

test('language configuration indents informal signatures and mixed prose blocks', () => {
    const configuration = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'language-configuration.json'), 'utf8'));
    const increase = new RegExp(configuration.indentationRules.increaseIndentPattern);
    const decrease = new RegExp(configuration.indentationRules.decreaseIndentPattern);
    for (const line of [
        'function Output perform(Input input):',
        '    function Output method(Input input):',
        'async fn perform(input: Input) -> Output:',
        '    > For each item in values:',
        '    if count > 0: # preserve an inline comment'
    ]) {
        assert.ok(increase.test(line), `indent after ${line}`);
    }
    assert.ok(!increase.test('    > Return total.'));
    assert.ok(!increase.test('    > Include #ordinary: prose'));
    assert.ok(decrease.test('    else:'));
    assert.ok(!decrease.test('    > else:'));
});
