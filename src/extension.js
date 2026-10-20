'use strict';

const vscode = require('vscode');
const path = require('node:path');
const { analyze, symbolAt, referencesTo } = require('./language');
const { keywords, types, primitives, reserved, isCodePosition, callAt, localRef } = require('./features');

const selector = { language: 'plainlogic' };
const symbolKinds = {
    unit: 'Namespace', require: 'Constant', ref: 'File', open: 'Event',
    type: 'TypeParameter', record: 'Struct', fn: 'Function', port: 'Interface',
    case: 'Method', parameter: 'Variable', variable: 'Variable', field: 'Field'
};
const outlineKinds = new Set(['unit', 'require', 'ref', 'open', 'type', 'record', 'fn', 'port', 'case', 'field']);
const completionKinds = {
    fn: 'Function', port: 'Interface', record: 'Struct', type: 'Class',
    require: 'Constant', ref: 'Reference', open: 'Event', parameter: 'Variable',
    variable: 'Variable', field: 'Field', unit: 'Module', case: 'Method'
};
function range(item) {
    return new vscode.Range(item.line, item.start, item.line, item.end);
}

function activate(context) {
    const cache = new Map();
    const diagnostics = vscode.languages.createDiagnosticCollection('plainlogic');
    function model(document) {
        const key = document.uri.toString();
        const existing = cache.get(key);
        if (existing && existing.version === document.version) return existing.value;
        const value = analyze(document.getText());
        cache.set(key, { version: document.version, value });
        return value;
    }
    function update(document) {
        if (document.languageId !== 'plainlogic') return;
        if (!vscode.workspace.getConfiguration('plainlogic', document.uri).get('diagnostics.enabled', true)) {
            diagnostics.delete(document.uri);
            return;
        }
        const levels = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning,
            information: vscode.DiagnosticSeverity.Information };
        diagnostics.set(document.uri, model(document).diagnostics.map(item => {
            const value = new vscode.Diagnostic(range(item), item.message, levels[item.severity]);
            value.source = 'PlainLogic (structure)';
            value.code = item.code;
            return value;
        }));
    }
    function selected(document, position) {
        if (!isCodePosition(document.lineAt(position.line).text, position.character)) return undefined;
        return symbolAt(model(document), position.line, position.character);
    }
    function references(document, symbol) {
        return referencesTo(model(document), symbol);
    }
    function checkRename(symbol) {
        if (symbol && ['field', 'parameter'].includes(symbol.kind)) {
            throw new Error('Field and parameter rename is unavailable because member and named-argument uses are not resolved.');
        }
    }
    context.subscriptions.push(diagnostics,
        vscode.workspace.onDidOpenTextDocument(update),
        vscode.workspace.onDidChangeTextDocument(event => update(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => {
            diagnostics.delete(document.uri);
            cache.delete(document.uri.toString());
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('plainlogic')) vscode.workspace.textDocuments.forEach(update);
        }),
        { dispose: () => cache.clear() });

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols(document) {
            const source = model(document);
            const nodes = new Map();
            for (const symbol of source.symbols) {
                if (!outlineKinds.has(symbol.kind)) continue;
                const endLine = Math.min(symbol.endLine, document.lineCount - 1);
                const fullRange = new vscode.Range(symbol.line, 0, endLine, document.lineAt(endLine).text.length);
                const node = new vscode.DocumentSymbol(symbol.name, symbol.kind,
                    vscode.SymbolKind[symbolKinds[symbol.kind] || 'Variable'], fullRange, range(symbol));
                nodes.set(symbol.id, node);
            }
            const roots = [];
            for (const symbol of source.symbols) {
                const node = nodes.get(symbol.id);
                if (!node) continue;
                const parent = nodes.get(symbol.parent);
                if (parent) parent.children.push(node);
                else roots.push(node);
            }
            return roots;
        }
    }));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition(document, position) {
            const symbol = selected(document, position);
            return symbol ? new vscode.Location(document.uri, range(symbol)) : undefined;
        }
    }));
    context.subscriptions.push(vscode.languages.registerReferenceProvider(selector, {
        provideReferences(document, position, options) {
            const symbol = selected(document, position);
            return symbol ? references(document, symbol)
                .filter(item => options.includeDeclaration || !item.declaration)
                .map(item => new vscode.Location(document.uri, range(item))) : [];
        }
    }));
    context.subscriptions.push(vscode.languages.registerDocumentHighlightProvider(selector, {
        provideDocumentHighlights(document, position) {
            const symbol = selected(document, position);
            return symbol ? references(document, symbol).map(item => new vscode.DocumentHighlight(range(item),
                item.declaration ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read)) : [];
        }
    }));
    context.subscriptions.push(vscode.languages.registerRenameProvider(selector, {
        prepareRename(document, position) {
            const symbol = selected(document, position);
            if (!symbol) throw new Error('Choose a declared PlainLogic identifier in exact logic. Prose is left intact.');
            checkRename(symbol);
            const occurrence = references(document, symbol).find(item => item.line === position.line &&
                item.start <= position.character && position.character <= item.end);
            return { range: range(occurrence || symbol), placeholder: symbol.name };
        },
        provideRenameEdits(document, position, name) {
            const symbol = selected(document, position);
            if (!symbol) return undefined;
            checkRename(symbol);
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || reserved.has(name)) {
                throw new Error('Use a nonreserved ASCII identifier.');
            }
            if (name !== symbol.name && model(document).symbols.some(item => item.name === name && item.id !== symbol.id)) {
                throw new Error('That name is already declared in this document; choose an unambiguous name.');
            }
            const edits = new vscode.WorkspaceEdit();
            for (const item of references(document, symbol)) edits.replace(document.uri, range(item), name);
            return edits;
        }
    }));
    context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
        provideHover(document, position) {
            const line = document.lineAt(position.line).text;
            if (line.trimStart().startsWith('>')) {
                if (position.character !== line.indexOf('>')) return undefined;
                return new vscode.Hover(keywords['>']);
            }
            if (!isCodePosition(line, position.character)) return undefined;
            const symbol = selected(document, position);
            if (symbol) {
                const content = new vscode.MarkdownString();
                content.appendCodeblock(symbol.signature, 'plainlogic');
                if (symbol.description) content.appendText('\n\n' + symbol.description);
                return new vscode.Hover(content);
            }
            const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
            const word = wordRange && document.getText(wordRange);
            return word && keywords[word] ? new vscode.Hover(keywords[word], wordRange) : undefined;
        }
    }));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
        provideCompletionItems(document, position) {
            const line = document.lineAt(position.line).text;
            if (!isCodePosition(line, position.character)) return [];
            const source = model(document);
            const before = line.slice(0, position.character);
            const link = /^\s*(covers|bind|ask)\s+[^#]*$/.exec(before);
            const requiredKind = link && { covers: 'require', bind: 'ref', ask: 'open' }[link[1]];
            const owners = source.symbols.filter(item => ['fn', 'port', 'record', 'case'].includes(item.kind) &&
                item.line <= position.line && item.endLine >= position.line);
            owners.sort((a, b) => b.line - a.line);
            const owner = owners[0];
            const names = new Map();
            for (const symbol of source.symbols) {
                if (requiredKind && symbol.kind !== requiredKind) continue;
                if (!requiredKind && symbol.parent && symbol.parent !== owner?.id) continue;
                if (symbol.kind === 'field') continue;
                const item = new vscode.CompletionItem(symbol.name,
                    vscode.CompletionItemKind[completionKinds[symbol.kind] || 'Variable']);
                item.detail = symbol.signature;
                if (symbol.description) item.documentation = new vscode.MarkdownString().appendText(symbol.description);
                names.set(symbol.name, item);
            }
            if (!requiredKind) {
                for (const word of [...Object.keys(keywords).filter(word => word !== '>'), ...types, ...primitives,
                    'True', 'False', 'None']) {
                    if (names.has(word)) continue;
                    const item = new vscode.CompletionItem(word,
                        types.includes(word) ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Keyword);
                    item.documentation = keywords[word];
                    names.set(word, item);
                }
            }
            return [...names.values()];
        }
    }));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(selector, {
        provideSignatureHelp(document, position) {
            const call = callAt(document.lineAt(position.line).text.slice(0, position.character));
            if (!call) return undefined;
            const source = model(document);
            const target = symbolAt(source, position.line, call.start);
            if (!target || !['fn', 'port', 'record'].includes(target.kind)) return undefined;
            const params = source.symbols.filter(item => item.parent === target.id &&
                ['parameter', 'field'].includes(item.kind));
            const info = new vscode.SignatureInformation(target.signature, target.description);
            info.parameters = params.map(item => new vscode.ParameterInformation(item.name));
            const help = new vscode.SignatureHelp();
            help.signatures = [info];
            help.activeSignature = 0;
            help.activeParameter = Math.min(call.index, Math.max(0, params.length - 1));
            return help;
        }
    }, '(', ','));
    context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(selector, {
        provideFoldingRanges(document) {
            return model(document).folds.map(item =>
                new vscode.FoldingRange(item.start, item.end, vscode.FoldingRangeKind.Region));
        }
    }));
    context.subscriptions.push(vscode.languages.registerDocumentLinkProvider(selector, {
        provideDocumentLinks(document) {
            const base = document.uri.scheme === 'untitled' ?
                vscode.workspace.workspaceFolders?.[0]?.uri : vscode.Uri.joinPath(document.uri, '..');
            if (!base) return [];
            const links = [];
            for (let line = 0; line < document.lineCount; line++) {
                const ref = localRef(document.lineAt(line).text);
                if (!ref) continue;
                const target = vscode.Uri.joinPath(base, ref.path);
                const link = new vscode.DocumentLink(new vscode.Range(line, ref.start, line, ref.end), target);
                link.tooltip = 'Open referenced file (symbol hints still require source verification)';
                links.push(link);
            }
            return links;
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('plainlogic.newDocument', async () => {
        const draft = Object.values(require('../snippets/plainlogic.json'))
            .find(item => Array.isArray(item.body) && item.body[0] === 'plainlogic 0.2');
        if (!draft) throw new Error('The draft document snippet is unavailable.');
        const document = await vscode.workspace.openTextDocument({ language: 'plainlogic' });
        const editor = await vscode.window.showTextDocument(document);
        await editor.insertSnippet(new vscode.SnippetString(draft.body.join('\n') + '\n'));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('plainlogic.showReference', async () => {
        await vscode.commands.executeCommand('markdown.showPreview',
            vscode.Uri.file(path.join(context.extensionPath, 'docs', 'plainlogic.md')));
    }));
    vscode.workspace.textDocuments.forEach(update);
}

module.exports = { activate };
