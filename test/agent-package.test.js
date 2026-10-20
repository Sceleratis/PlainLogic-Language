'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const skill = path.join(root, 'skills/plainlogic');

test('the universal PlainLogic skill is one branded lowercase entry with all workflow references', () => {
    const text = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
    assert.match(text, /^---\r?\nname: plainlogic\r?\n/);
    assert.match(text, /^# PlainLogic$/m);
    for (const name of ['authoring', 'validation', 'implementation', 'conversion', 'plainlogic', 'extensibility']) {
        assert.ok(fs.existsSync(path.join(skill, 'references', name + '.md')), name);
    }
    assert.match(fs.readFileSync(path.join(skill, 'agents/openai.yaml'), 'utf8'), /display_name: ["']?PlainLogic/);
});

test('generated language and checker resources match repository sources', () => {
    const generated = '<!-- Generated resource; maintained in the source repository. -->\n\n';
    for (const name of ['plainlogic', 'extensibility']) {
        const source = fs.readFileSync(path.join(root, 'docs', name + '.md'), 'utf8')
            .replace(/\r\n?/g, '\n')
            .replaceAll('python tools/check_plainlogic.py', 'python <skill-directory>/scripts/check_plainlogic.py')
            .replaceAll('From the repository root, run the optional Python canonical checker:',
                'Run the bundled optional Python canonical checker:');
        const digest = text => createHash('sha256').update(text).digest('hex');
        assert.equal(digest(fs.readFileSync(path.join(skill, 'references', name + '.md'), 'utf8')),
            digest(generated + source), name + ' resource is stale; run npm run agents:sync');
    }
    const banner = '# Generated resource; maintained in the source repository (tools/check_plainlogic.py). Do not edit this copy; it is overwritten on sync.';
    const sourceChecker = fs.readFileSync(path.join(root, 'tools/check_plainlogic.py'), 'utf8');
    const ending = sourceChecker.includes('\r\n') ? '\r\n' : '\n';
    const expectedChecker = sourceChecker.startsWith('#!')
        ? sourceChecker.slice(0, sourceChecker.indexOf('\n') + 1) + banner + ending + sourceChecker.slice(sourceChecker.indexOf('\n') + 1)
        : banner + ending + sourceChecker;
    assert.equal(fs.readFileSync(path.join(skill, 'scripts/check_plainlogic.py'), 'utf8'), expectedChecker);
});

test('bundled skill examples mirror the repository examples byte for byte', () => {
    const repoExamples = fs.readdirSync(path.join(root, 'examples')).filter(name => name.endsWith('.plog')).sort();
    const bundled = fs.readdirSync(path.join(skill, 'assets/examples')).filter(name => name.endsWith('.plog')).sort();
    assert.deepEqual(bundled, repoExamples);
    for (const name of repoExamples) {
        assert.deepEqual(fs.readFileSync(path.join(skill, 'assets/examples', name)),
            fs.readFileSync(path.join(root, 'examples', name)), name);
    }
});
