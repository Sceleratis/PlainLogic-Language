'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const portable = readJson('plugin.json');
const codex = readJson('.codex-plugin/plugin.json');
const claude = readJson('.claude-plugin/plugin.json');
const codexCatalog = readJson('.agents/plugins/marketplace.json');
const claudeCatalog = readJson('.claude-plugin/marketplace.json');

function containedExistingPath(base, relativePath) {
  assert.match(relativePath, /^\.\//, 'package paths start with ./');
  assert.ok(!relativePath.split(/[\\/]/).includes('..'), 'package paths do not traverse parents');
  const resolvedBase = fs.realpathSync(base);
  const resolved = fs.realpathSync(path.resolve(base, relativePath));
  const relative = path.relative(resolvedBase, resolved);
  assert.ok(relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)),
    `${relativePath} must resolve within ${base}`);
  return resolved;
}

test('portable manifest follows the closed Agent Plugins 1.0.0 layout', () => {
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(portable.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.ok(portable.name.length <= 64);
  const allowed = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions']);
  for (const key of Object.keys(portable)) assert.ok(allowed.has(key), `unsupported portable field: ${key}`);
  assert.equal(typeof portable.description, 'string');
  assert.ok(portable.description.length > 0);
  assert.equal(Object.hasOwn(portable, 'skills'), false);
});

test('plugin identities and package versions agree across client manifests', () => {
  const npm = readJson('package.json');
  assert.equal(portable.name, 'plainlogic');
  assert.equal(portable.version, npm.version);
  for (const overlay of [codex, claude]) {
    for (const key of ['name', 'version', 'description', 'author', 'repository']) {
      assert.deepEqual(overlay[key], portable[key], `${key} differs from the portable identity`);
    }
  }
  assert.equal(portable.extensions['com.openai'].interface.displayName, 'PlainLogic');
  assert.deepEqual(codex.interface, portable.extensions['com.openai'].interface);
});

test('both clients discover the same single skill inside the plugin root', () => {
  const skillRoot = containedExistingPath(root, codex.skills);
  assert.equal(skillRoot, fs.realpathSync(path.join(root, 'skills')));
  assert.equal(Object.hasOwn(claude, 'skills'), false, 'Claude uses its default skills/ discovery');
  const skillNames = fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
  assert.deepEqual(skillNames, ['plainlogic']);
  const skill = fs.readFileSync(path.join(skillRoot, 'plainlogic', 'SKILL.md'), 'utf8');
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(frontmatter, 'the skill has YAML frontmatter');
  assert.match(frontmatter[1], /(?:^|\r?\n)name: plainlogic(?:\r?\n|$)/);
});

test('marketplace entries resolve to this plugin rather than hidden metadata directories', () => {
  assert.equal(codexCatalog.name, claudeCatalog.name);
  assert.equal(codexCatalog.name, 'plainlogic-local');
  assert.equal(codexCatalog.plugins.length, 1);
  assert.equal(claudeCatalog.plugins.length, 1);
  const codexEntry = codexCatalog.plugins[0];
  const claudeEntry = claudeCatalog.plugins[0];
  assert.equal(codexEntry.name, portable.name);
  assert.equal(claudeEntry.name, portable.name);
  assert.equal(codexEntry.source.source, 'local');
  assert.equal(containedExistingPath(root, codexEntry.source.path), fs.realpathSync(root));
  assert.equal(containedExistingPath(root, claudeEntry.source), fs.realpathSync(root));
  assert.equal(codexEntry.policy.installation, 'AVAILABLE');
  assert.equal(codexEntry.policy.authentication, 'ON_INSTALL');
  assert.equal(codexEntry.category, 'Developer Tools');
});

test('skill resources remain contained after filesystem link resolution', () => {
  const skillRoot = containedExistingPath(root, './skills/plainlogic');
  const pending = [skillRoot];
  const visited = new Set();
  while (pending.length) {
    const directory = pending.pop();
    const realDirectory = fs.realpathSync(directory);
    if (visited.has(realDirectory)) continue;
    visited.add(realDirectory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = `./${path.relative(skillRoot, entryPath).split(path.sep).join('/')}`;
      const resolved = containedExistingPath(skillRoot, relativePath);
      if (fs.statSync(resolved).isDirectory()) pending.push(resolved);
    }
  }
});

test('agent packaging declares no hooks, servers, or automatic installation policy', () => {
  for (const manifest of [portable, codex, claude, portable.extensions['com.openai']]) {
    for (const key of ['hooks', 'mcpServers', 'apps', 'agents', 'commands', 'enabled', 'defaultEnabled']) {
      assert.equal(Object.hasOwn(manifest, key), false, `unexpected executable or activation surface: ${key}`);
    }
  }
});
