'use strict';

// This module is loaded by a real VS Code extension test host, not by node --test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const root = path.resolve(__dirname, '..');
const reportPath = process.env.PLAINLOGIC_TEST_REPORT || path.join(root, '.vscode-test', 'manual-host-report.json');
const report = { runId: process.env.PLAINLOGIC_TEST_RUN_ID, completed: false, vscode: vscode.version, tests: [] };

function writeReport() {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}

async function check(name, operation) {
    const started = Date.now();
    let timer;
    try {
        await Promise.race([
            operation(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test exceeded 12 seconds.')), 12000); })
        ]);
        report.tests.push({ name, passed: true, durationMs: Date.now() - started });
        console.log(`PASS ${name}`);
    } catch (error) {
        report.tests.push({ name, passed: false, durationMs: Date.now() - started, error: error.stack || String(error) });
        console.error(`FAIL ${name}: ${error.stack || error}`);
    } finally {
        clearTimeout(timer);
        writeReport();
    }
}

async function until(condition, message) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.fail(message);
}

function lineOf(document, fragment) {
    const line = document.getText().split(/\r?\n/).findIndex(value => value.includes(fragment));
    assert.notEqual(line, -1, `Missing test fragment ${fragment}`);
    return line;
}

function at(document, fragment, token, offset = 0) {
    const line = lineOf(document, fragment);
    const column = document.lineAt(line).text.indexOf(token);
    assert.notEqual(column, -1, `Missing token ${token}`);
    return new vscode.Position(line, column + offset);
}

function flatten(symbols) {
    return symbols.flatMap(symbol => [symbol, ...flatten(symbol.children || [])]);
}

function labels(completions) {
    return (completions?.items || []).map(item => typeof item.label === 'string' ? item.label : item.label.label);
}

function hoverText(hovers) {
    return (hovers || []).flatMap(hover => hover.contents).map(item => typeof item === 'string' ? item : item.value || '').join('\n');
}

function ownDiagnostics(document) {
    return vscode.languages.getDiagnostics(document.uri).filter(item => item.source === 'PlainLogic (structure)');
}

async function fragment(content) {
    return vscode.workspace.openTextDocument({ language: 'plainlogic', content });
}

async function run() {
    writeReport();
    let quote;
    let informal;
    const extension = vscode.extensions.getExtension('plainlogic-local.plainlogic');
    if (!extension) throw new Error('The development PlainLogic extension was not loaded.');
    await extension.activate();
    report.extensionVersion = extension.packageJSON.version;

    await check('real extension activates and .plog examples select PlainLogic', async () => {
        assert.equal(extension.isActive, true);
        quote = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'examples', 'quote-total.plog')));
        informal = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'examples', 'execute-request.plog')));
        assert.equal(quote.languageId, 'plainlogic');
        assert.equal(informal.languageId, 'plainlogic');
        const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', informal.uri);
        assert.ok(flatten(symbols || []).some(symbol => symbol.name === 'executeRequest'));
        assert.deepEqual(ownDiagnostics(informal), []);
    });

    await check('outline contains routines, requirements, records, and record fields', async () => {
        const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', quote.uri);
        const all = flatten(symbols || []);
        for (const name of ['quote', 'R1', 'Line', 'Quote', 'price_cents']) assert.ok(all.some(item => item.name === name), name);
        const record = all.find(item => item.name === 'Line');
        assert.ok(record.children.some(item => item.name === 'quantity'));
        const fn = all.find(item => item.name === 'quote');
        assert.ok(fn.range.end.line > fn.range.start.line);
    });

    await check('completion uses metadata kind and routine-local scope', async () => {
        const metadata = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', quote.uri,
            at(quote, 'covers R1', 'covers ', 'covers '.length));
        assert.ok(labels(metadata).includes('R1'));
        assert.equal(labels(metadata).includes('quote'), false);
        const document = await fragment('fn first() -> Int:\n    private_first = 1\n    return private_first\nfn second() -> Int:\n    private_second = 2\n    return private_second');
        const local = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri,
            at(document, 'return private_second', 'private_second', 2));
        assert.ok(labels(local).includes('private_second'));
        assert.equal(labels(local).includes('private_first'), false);
    });

    await check('hover shows routine signatures and keyword explanations', async () => {
        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', quote.uri,
            at(quote, 'expect quote(lines)', 'quote', 2));
        assert.match(hoverText(hovers), /fn quote\(lines: List\[Line\]\) -> Quote:/);
        const keyword = await vscode.commands.executeCommand('vscode.executeHoverProvider', quote.uri,
            at(quote, 'covers R1', 'covers', 2));
        assert.match(hoverText(keyword), /Requirement IDs/);
    });

    await check('definition links routines, metadata, and short loop/given declarations', async () => {
        const definition = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', quote.uri,
            at(quote, 'expect quote(lines)', 'quote', 1));
        assert.equal(definition[0].range.start.line, lineOf(quote, 'fn quote('));
        const requirement = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', quote.uri,
            at(quote, 'covers R1', 'R1', 1));
        assert.equal(requirement[0].range.start.line, lineOf(quote, 'require R1'));
        const document = await fragment('fn run(items: List[Int]) -> Int:\n    for r in items:\n        return r\ncase example:\n    given n = 2\n    expect run([n]) == 2');
        const loop = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, new vscode.Position(2, 15));
        const given = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, new vscode.Position(5, 16));
        assert.equal(loop[0].range.start.character, 8);
        assert.equal(given[0].range.start.character, 10);
    });

    const scopedText = 'fn first(value: Int) -> Int:\n    total = value\n    > Return total with first\'s formatting.\n    text = "total first"\n    return total\nfn second(value: Int) -> Int:\n    total = value\n    return total';
    await check('references and rename stay in one routine and protect English and strings', async () => {
        const document = await fragment(scopedText);
        const position = new vscode.Position(4, 12);
        const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', document.uri, position);
        assert.deepEqual(references.map(item => item.range.start.line).sort((a, b) => a - b), [1, 4]);
        const edits = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', document.uri, position, 'first_total');
        const changes = edits.get(document.uri);
        assert.deepEqual(changes.map(item => item.range.start.line).sort((a, b) => a - b), [1, 4]);
        assert.ok(changes.every(item => item.newText === 'first_total'));
        // Querying the numeric suffix must not edit an unrelated declaration.
        const numeric = await fragment('fn xFF() -> Int:\n    return 0xFF');
        let numericRefused = false;
        try {
            const numericEdits = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', numeric.uri, new vscode.Position(1, 13), 'renamed');
            numericRefused = !numericEdits || numericEdits.size === 0;
        } catch {
            numericRefused = true;
        }
        assert.equal(numericRefused, true);
    });

    await check('unsafe field and parameter renames are refused', async () => {
        const document = await fragment('record Value:\n    field: Int\nfn run(input: Int) -> Int:\n    return input');
        for (const position of [new vscode.Position(1, 6), new vscode.Position(2, 9)]) {
            let refused = false;
            try {
                const edit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', document.uri, position, 'changed');
                refused = !edit || edit.size === 0;
            } catch {
                refused = true;
            }
            assert.equal(refused, true);
        }
    });

    await check('folding includes exact blocks and English control blocks', async () => {
        const document = await fragment('fn total(values: List[Int]) -> Int:\n    > For each value in values:\n        if value > 0:\n            > Add value to the total.\n    > Return the total.\n    # Preserve this explanation.');
        const folds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', document.uri);
        assert.ok(folds.some(item => item.start === 0 && item.end === 5));
        assert.ok(folds.some(item => item.start === 1 && item.end === 3));
        assert.ok(folds.some(item => item.start === 2 && item.end === 3));
    });

    await check('signature help resolves a real call and rejects shadowed or duplicate callees', async () => {
        const signature = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', quote.uri,
            at(quote, 'expect quote(lines)', 'quote(', 'quote('.length));
        assert.match(signature.signatures[0].label, /fn quote/);
        assert.equal(signature.signatures[0].parameters.length, 1);
        const shadowed = await fragment('fn send(value: Int) -> Int:\n    return value\nfn other(send: Int) -> Int:\n    return send(1)');
        const shadowHelp = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', shadowed.uri, new vscode.Position(3, 16));
        assert.ok(!shadowHelp || shadowHelp.signatures.length === 0);
        const duplicate = await fragment('fn send(value: Int) -> Int:\n    return value\nfn send(other: Int) -> Int:\n    return other\nfn run() -> Int:\n    return send(1)');
        const duplicateHelp = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', duplicate.uri, new vscode.Position(5, 16));
        assert.ok(!duplicateHelp || duplicateHelp.signatures.length === 0);
    });

    await check('document links expose local lookup hints and leave action URLs inert', async () => {
        const document = await fragment('ref guide "docs/plainlogic.md#Document surface"\nref action "command:workbench.action.closeWindow"\nref remote "https://example.com/"\n> Open docs/plainlogic.md');
        const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', document.uri);
        // VS Code's built-in URL detector may add an ordinary HTTPS link; this
        // extension contributes only the relative file lookup and no action URI.
        const local = links.filter(link => link.range.start.line === 0);
        assert.equal(local.length, 1);
        assert.equal(local[0].target.scheme, 'file');
        assert.equal(path.resolve(local[0].target.fsPath), path.resolve(root, 'docs', 'plainlogic.md'));
        assert.equal(links.some(link => link.target?.scheme === 'command' || link.range.start.line === 1), false);
    });

    await check('English, comments, and strings have no code navigation or completion', async () => {
        const document = await fragment('fn target() -> Int:\n    > Call target with "unbalanced prose # intact.\n    # target\n    text = "target"\n    return 1');
        for (const position of [new vscode.Position(1, 13), new vscode.Position(2, 8), new vscode.Position(3, 15)]) {
            const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, position);
            const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', document.uri, position);
            const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, position);
            const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position);
            assert.equal(definitions?.length || 0, 0);
            assert.equal(references?.length || 0, 0);
            assert.equal(labels(completions).includes('target'), false);
            assert.equal(hovers?.length || 0, 0);
        }
    });

    await check('live diagnostics update and clear after an in-memory document edit', async () => {
        const prefix = 'plainlogic 0.2\nunit LiveCheck\nstate ready\nintent "Return the input."\nscope "Only this routine."\nrequire R1 "Return the input."\n';
        const document = await fragment(prefix + 'open Q1 "Which input?"\nfn run(value: Int) -> Int:\n    covers Missing\n    ask Q1\n    return value');
        await until(() => ownDiagnostics(document).some(item => item.code === 'unresolved-reference'), 'Expected live unresolved-reference diagnostic.');
        const codes = ownDiagnostics(document).map(item => item.code);
        for (const code of ['ready-open', 'ready-ask', 'uncovered-requirement']) assert.ok(codes.includes(code), code);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
            prefix + 'fn run(value: Int) -> Int:\n    covers R1\n    return value');
        const previousVersion = document.version;
        assert.equal(await vscode.workspace.applyEdit(edit), true);
        assert.ok(document.version > previousVersion);
        await until(() => ownDiagnostics(document).length === 0, 'Diagnostics did not clear after fixing the document.');
    });

    await check('New Draft creates an untitled PlainLogic document with expanded snippet text', async () => {
        await vscode.commands.executeCommand('plainlogic.newDocument');
        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document);
        assert.equal(document.isUntitled, true);
        assert.equal(document.languageId, 'plainlogic');
        assert.match(document.getText(), /^plainlogic 0\.2\r?\n/);
        assert.match(document.getText(), /state draft/);
        assert.match(document.getText(), /open Q1/);
        assert.equal(document.getText().includes('${'), false);
    });

    report.completed = true;
    report.passed = report.tests.filter(item => item.passed).length;
    report.failed = report.tests.length - report.passed;
    writeReport();
    if (report.failed) throw new Error(`${report.failed} of ${report.tests.length} VS Code integration checks failed. See ${reportPath}`);
}

module.exports = { run };
