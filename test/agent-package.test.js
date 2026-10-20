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
            .replaceAll('python tools/check_plainlogic.py', 'python <skill-dir>/scripts/check_plainlogic.py')
            .replaceAll('From the repository root, run the optional Python canonical checker:',
                'Run the bundled optional Python canonical checker:');
        const digest = text => createHash('sha256').update(text).digest('hex');
        assert.equal(digest(fs.readFileSync(path.join(skill, 'references', name + '.md'), 'utf8')),
            digest(generated + source), name + ' resource is stale; run npm run agents:sync');
    }
    assert.deepEqual(fs.readFileSync(path.join(skill, 'scripts/check_plainlogic.py')),
        fs.readFileSync(path.join(root, 'tools/check_plainlogic.py')));
});
