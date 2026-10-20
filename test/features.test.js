'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCodePosition, callAt, localRef } = require('../src/features');

test('editor suggestions stay out of prose, strings, and comments', () => {
    assert.equal(isCodePosition('    > Send request # with "unbalanced text', 35), false);
    assert.equal(isCodePosition('return load("a#b", value)', 22), true);
    assert.equal(isCodePosition('return load("a#b', 15), false);
    assert.equal(isCodePosition('return value # comment', 20), false);
    assert.equal(isCodePosition('return "escaped \\" text"', 20), false);
});

test('signature help respects nested calls, collection literals, and quoted commas', () => {
    assert.deepEqual(callAt('return send(url, payload'), { opener: '(', name: 'send', index: 1, start: 7 });
    assert.deepEqual(callAt('return send(url, encode('), { opener: '(', name: 'encode', index: 0, start: 17 });
    assert.deepEqual(callAt('return send({"a": [1, 2]}, "a,b", '),
        { opener: '(', name: 'send', index: 2, start: 7 });
    assert.equal(callAt('    > Send request using call(url,'), undefined);
    assert.equal(callAt('return transport.send(url,'), undefined);
});

test('ref links accept relative files and keep code and external URLs inert', () => {
    assert.deepEqual(localRef('ref client "src/client.py#Client.send"'), {
        path: 'src/client.py', start: 12, end: 37
    });
    assert.equal(localRef('ref client "https://example.com/api"'), undefined);
    assert.equal(localRef('ref client "command:workbench.action.closeWindow"'), undefined);
    assert.equal(localRef('ref client "C:\\\\secrets.txt"'), undefined);
    assert.equal(localRef('    > Open src/client.py'), undefined);
});
