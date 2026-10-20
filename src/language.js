'use strict';

const IDENTIFIER = /[A-Za-z_][A-Za-z_0-9]*/g;
const KEYWORDS = new Set(('plainlogic unit state draft ready intent scope target require ref open type record fn async port case covers effect contract bind given stub returns expect if elif else for in to while break continue return raise try except as finally ask await and or not is True False None pure read write external function enum alias native').split(' '));
const EXTENSION_KEYWORDS = new Set(['alias', 'native', 'target', 'to']);
const EXPECTED_METADATA = { covers: 'require', bind: 'ref', ask: 'open' };

/** Mask strings and comments without changing UTF-16 offsets. Prose is opaque. */
function lex(raw) {
    const indentText = raw.match(/^\s*/)[0];
    const indent = indentText.replace(/\t/g, '    ').length;
    const prose = raw.slice(indentText.length).startsWith('>');
    if (prose) return { raw, indent, indentText, prose, code: raw, masked: '', meaningful: true, unclosed: -1 };
    // Descriptions are literal English, including hashes and unmatched quotes.
    const alias = /^\s*alias\s+[A-Za-z_]\w*\s*->/.exec(raw);
    if (alias) return { raw, indent, indentText, prose: false, code: raw, masked: raw.slice(0, alias[0].length).padEnd(raw.length), meaningful: true, unclosed: -1, aliasRhs: alias[0].length };
    let quote = null;
    let quoteStart = -1;
    let commentStart = raw.length;
    const chars = raw.split('');
    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];
        if (quote) {
            chars[i] = ' ';
            if (char === '\\' && i + 1 < raw.length) {
                chars[++i] = ' ';
            } else if (char === quote) {
                quote = null;
            }
        } else if (char === '#' ) {
            commentStart = i;
            chars.fill(' ', i);
            break;
        } else if (char === '"' || char === "'") {
            quote = char;
            quoteStart = i;
            chars[i] = ' ';
        }
    }
    return { raw, indent, indentText, prose, code: raw.slice(0, commentStart), masked: chars.join(''), meaningful: raw.slice(0, commentStart).trim().length > 0, unclosed: quote ? quoteStart : -1 };
}

/** Find a counted-loop separator outside strings and nested brackets. */
function countedLoop(info) {
    const match = /^\s*for\s+([A-Za-z_]\w*)\s*=\s*(.*):\s*$/.exec(info.code);
    if (!match) return undefined;
    const expressionStart = info.code.indexOf('=', info.code.indexOf(match[1])) + 1;
    const expression = info.masked.slice(expressionStart, info.code.lastIndexOf(':'));
    let depth = 0;
    const separators = [];
    for (let i = 0; i < expression.length; i++) {
        if ('([{'.includes(expression[i])) depth++;
        else if (')]}'.includes(expression[i])) depth--;
        else if (depth === 0 && /^to(?=\s|$)/.test(expression.slice(i)) && /\s/.test(expression[i - 1] || '')) {
            separators.push(i);
            i++;
        }
    }
    const split = separators[0];
    return { name: match[1], start: info.code.indexOf(match[1], info.code.indexOf('for') + 3),
        valid: separators.length === 1 && info.code.slice(expressionStart, expressionStart + split).trim().length > 0 && info.code.slice(expressionStart + split + 2, info.code.lastIndexOf(':')).trim().length > 0 };
}

/** Split a parameter list without splitting nested collection or inline enum types. */
function parameterParts(text, offset) {
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quote) {
            if (char === '\\') i++;
            else if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if ('([{'.includes(char)) depth++;
        else if (')]}'.includes(char)) depth--;
        else if (char === ',' && depth === 0) {
            parts.push({ text: text.slice(start, i), offset: offset + start });
            start = i + 1;
        }
    }
    parts.push({ text: text.slice(start), offset: offset + start });
    return parts;
}

function quotedDescription(code) {
    const match = code.match(/["'](.*)["']\s*$/);
    return match ? match[1] : undefined;
}

function precedingDescription(infos, line) {
    const comments = [];
    for (let i = line - 1; i >= 0 && !infos[i].nativeBody && /^\s*#/.test(infos[i].raw); i--) {
        comments.unshift(infos[i].raw.replace(/^\s*#\s?/, ''));
    }
    return comments.length ? comments.join('\n') : undefined;
}

/**
 * Analyze an editor document without executing text, reading refs, or interpreting English.
 * All positions are zero-based UTF-16 offsets; end offsets are exclusive. `lines` contains
 * source strings. Symbols have {id,name,kind,line,start,end,endLine,signature,description?,parent?};
 * parent is a symbol id. Occurrences have {name,line,start,end,declaration,symbolId?} and
 * link only when the lexical scope is unambiguous. Fields/property names and prose are
 * deliberately not inferred. Folds use inclusive {start,end,kind} line numbers.
 * `opaqueRanges` contains per-line {line,start,end} literal regions; exclusive ends
 * include the cursor at end of line so providers cannot activate inside native text.
 * Nonbinding alias-body and native symbols describe outline/folding containers only.
 * Diagnostics are editor structural checks, not a semantic validator or compiler.
 */
function analyze(text) {
    const lines = text.split(/\r\n|\n|\r/);
    const infos = lines.map(lex);
    const legacySurface = /^plainlogic\s+0\.[12]\s*$/.test(infos.find(info => info.meaningful)?.code.trim() || '');
    const nativeBlocks = new Map();
    const opaqueRanges = [];
    // Establish literal regions before any PlainLogic scanning. Even malformed margin
    // lines remain protected until a nonblank line dedents to the header level.
    for (let line = 0; line < infos.length; line++) {
        const info = infos[line];
        const match = /^native\s+(?:"((?:\\.|[^"\\\r\n])+)"|'((?:\\.|[^'\\\r\n])+)'|([A-Za-z_][A-Za-z_0-9.-]*))\s*:\s*$/.exec(info.code.trim());
        if (info.prose || (!match && (legacySurface || !/^native(?:\s|:|$)/.test(info.code.trim())))) continue;
        const block = { line, end: line, label: match ? match[1] || match[2] || match[3] : '(invalid header)', invalidHeader: !match, margin: info.indent + 4, invalidMargins: [] };
        for (let next = line + 1; next < infos.length; next++) {
            const body = infos[next];
            if (body.raw.trim() && body.indent <= info.indent) break;
            block.end = next;
            if (body.raw.trim() && !body.raw.startsWith(' '.repeat(block.margin))) block.invalidMargins.push(next);
            opaqueRanges.push({ line: next, start: 0, end: body.raw.length + 1 });
            infos[next] = { ...body, meaningful: false, prose: false, code: '', masked: '', unclosed: -1, nativeBody: true };
        }
        nativeBlocks.set(line, block);
        line = block.end;
    }
    for (let line = 0; line < infos.length; line++) {
        if (infos[line].aliasRhs !== undefined) opaqueRanges.push({ line, start: infos[line].aliasRhs, end: lines[line].length + 1 });
    }
    const meaningful = infos.map((info, line) => info.meaningful ? line : -1).filter(line => line >= 0);
    const first = meaningful.length ? infos[meaningful[0]].code.trim() : '';
    const isCanonical = meaningful.some(line => /^plainlogic\b/.test(infos[line].code.trim()));
    const header = isCanonical ? meaningful.find(line => /^plainlogic\b/.test(infos[line].code.trim())) : undefined;
    const version = header === undefined ? undefined : infos[header].code.trim().match(/^plainlogic\s+(\S+)/)?.[1];
    const isKeyword = name => KEYWORDS.has(name) && (!['0.1', '0.2'].includes(version) || !EXTENSION_KEYWORDS.has(name));
    const symbols = [];
    const occurrences = [];
    const diagnostics = [];
    const folds = [];
    const scopes = [];
    const scopeByLine = new Map();
    const globals = new Map();
    const locals = new Map();
    const declarations = new Map();
    const metadata = [];
    const coverage = new Set();
    const endLines = new Map();
    const typeRanges = new Map();
    const ignoredRanges = new Map();
    const invocations = new Map();

    function diagnostic(line, start, end, code, message, severity = 'error') {
        diagnostics.push({ line, start: Math.max(0, start), end: Math.max(start + 1, end), severity, code, message });
    }

    function addSymbol(name, kind, line, start, parent, options = {}) {
        const symbol = { id: `${kind}:${name}:${line}:${start}`, name, kind, line, start, end: start + name.length,
            endLine: options.endLine ?? line, signature: infos[line].code.trim(), ...options };
        if (parent) symbol.parent = parent.id;
        symbols.push(symbol);
        declarations.set(`${line}:${start}`, symbol);
        if (!parent) {
            const sameName = globals.get(name) || [];
            sameName.push(symbol);
            globals.set(name, sameName);
        } else {
            let table = locals.get(parent.id);
            if (!table) locals.set(parent.id, table = new Map());
            // A record field belongs to its declaration, never to unrelated property uses.
            if (kind === 'parameter' && table.has(name)) table.set(name, null);
            else table.set(name, symbol);
        }
        return symbol;
    }

    // Scopes are pushed in ascending line order, so the owning scope is the
    // first match scanning backwards. Results are memoized per line: matching
    // scopes for a line all start before it, so an entry computed while later
    // declarations are still being collected stays valid.
    const ownerByLine = new Map();
    function owningScope(line, includeDeclaration = false) {
        const key = includeDeclaration ? `${line}:d` : `${line}`;
        if (ownerByLine.has(key)) return ownerByLine.get(key);
        let found;
        for (let index = scopes.length - 1; index >= 0; index--) {
            const scope = scopes[index];
            if ((scope.symbol.line < line || (includeDeclaration && scope.symbol.line === line))
                && line <= scope.symbol.endLine && (scope.symbol.line === line || infos[line].indent > scope.indent)) {
                found = scope.symbol;
                break;
            }
        }
        ownerByLine.set(key, found);
        return found;
    }

    function addRange(map, line, start, end) {
        const ranges = map.get(line) || [];
        ranges.push([start, end]);
        map.set(line, ranges);
    }

    function addContainer(name, kind, line, start, parent) {
        const symbol = { id: `${kind}:${line}`, name, kind, line, start, end: start + name.length,
            endLine: endLines.get(line) ?? line, signature: infos[line].code.trim(), ...(parent ? { parent: parent.id } : {}) };
        symbols.push(symbol);
        return symbol;
    }

    // Computing extent from significant lines includes comments inside and at the end of a block.
    for (let index = 0; index < meaningful.length; index++) {
        const line = meaningful[index];
        const info = infos[line];
        const trimmed = info.code.trimEnd();
        if (info.aliasRhs !== undefined) continue;
        if (nativeBlocks.has(line)) {
            const block = nativeBlocks.get(line);
            endLines.set(line, block.end);
            if (block.invalidHeader) diagnostic(line, info.indentText.length, info.code.length, 'native-header', 'Use native "language": or native language:. Its indented content remains protected while the header is incomplete.');
            if (!infos.slice(line + 1, block.end + 1).some(item => item.raw.trim())) diagnostic(line, trimmed.length - 1, trimmed.length, 'empty-block', 'A native block needs literal content.');
            if (block.end > line) folds.push({ start: line, end: block.end, kind: 'region' });
            for (const bad of block.invalidMargins) diagnostic(bad, 0, Math.max(1, infos[bad].indentText.length), 'native-margin', `Native content needs a container margin of ${block.margin} spaces; remaining indentation is literal.`);
            continue;
        }
        if (!trimmed.endsWith(':')) continue;
        const next = meaningful[index + 1];
        if (next === undefined || infos[next].indent <= info.indent) {
            diagnostic(line, Math.max(info.indent, trimmed.length - 1), trimmed.length, 'empty-block', 'A block ending in : needs an indented body.');
            endLines.set(line, line);
            continue;
        }
        let boundary = meaningful.slice(index + 1).find(nextLine => infos[nextLine].indent <= info.indent);
        if (boundary === undefined) boundary = lines.length;
        let end = boundary - 1;
        while (end > line && !infos[end].raw.trim()) end--;
        endLines.set(line, end);
        if (end > line) folds.push({ start: line, end, kind: 'region' });
    }

    // Declare top-level names and routine/record/case scopes before resolving uses.
    for (const line of meaningful) {
        const info = infos[line];
        if (info.prose) continue;
        const trimmed = info.code.trim();
        const owner = owningScope(line);
        if (nativeBlocks.has(line)) {
            const symbol = addContainer(`native ${nativeBlocks.get(line).label}`, 'native', line, info.indentText.length, owner);
            symbol.end = info.code.length;
            addRange(ignoredRanges, line, 0, info.raw.length);
            continue;
        }
        let aliasMatch = trimmed.match(/^alias\s+([A-Za-z_]\w*)\s*->(.*)$/);
        if (aliasMatch) {
            const start = info.raw.indexOf(aliasMatch[1], info.raw.indexOf('alias') + 5);
            if (info.indent !== 0) diagnostic(line, start, start + aliasMatch[1].length, 'alias-context', 'Declare behavior aliases at document top level.');
            else addSymbol(aliasMatch[1], 'alias', line, start, null, { description: aliasMatch[2].trim() });
            if (!aliasMatch[2].trim()) diagnostic(line, info.aliasRhs, info.raw.length, 'alias-description', 'Describe the behavior after ->.');
            continue;
        }
        aliasMatch = trimmed.match(/^([A-Za-z_]\w*)\s*:\s*$/);
        if (aliasMatch && !isKeyword(aliasMatch[1])) {
            const start = info.indentText.length;
            invocations.set(line, { name: aliasMatch[1], start, end: start + aliasMatch[1].length, owner });
            const symbol = addContainer(aliasMatch[1], 'alias-body', line, start, owner);
            scopes.push({ symbol, indent: info.indent });
            scopeByLine.set(line, symbol);
            continue;
        }
        let match = trimmed.match(/^(?:async\s+)?(fn|port)\s+([A-Za-z_]\w*)\s*\((.*)\)\s*->\s*(.+?)\s*:\s*$/);
        let informal = false;
        if (!match) {
            const human = trimmed.match(/^function\s+(?:(.+?)\s+)?([A-Za-z_]\w*)\s*\((.*)\)\s*(?:->\s*.+?)?\s*:\s*$/);
            if (human) {
                match = [human[0], 'fn', human[2], human[3], human[1]];
                informal = true;
            }
        }
        if (match && (!owner || informal)) {
            const kind = match[1];
            const name = match[2];
            const nameStart = info.code.lastIndexOf(name, info.code.indexOf('('));
            const symbol = addSymbol(name, kind, line, nameStart, owner, {
                endLine: endLines.get(line) ?? line,
                description: precedingDescription(infos, line),
            });
            scopes.push({ symbol, indent: info.indent, informal });
            scopeByLine.set(line, symbol);
            const paramsStart = info.raw.indexOf('(', nameStart) + 1;
            const paramsEnd = info.code.lastIndexOf(')');
            for (const part of parameterParts(match[3], paramsStart)) {
                const canonicalParam = part.text.match(/^\s*([A-Za-z_]\w*)\s*:\s*(.+)$/);
                let paramName;
                let paramStart;
                if (canonicalParam) {
                    paramName = canonicalParam[1];
                    paramStart = part.offset + part.text.indexOf(paramName);
                    addRange(typeRanges, line, part.offset + part.text.indexOf(':') + 1, part.offset + part.text.length);
                } else if (informal) {
                    const inlineEnum = part.text.match(/^\s*enum\s+([A-Za-z_]\w*)\s*\[/);
                    const trailingName = part.text.match(/([A-Za-z_]\w*)\s*$/);
                    if (inlineEnum || trailingName) {
                        paramName = inlineEnum ? inlineEnum[1] : trailingName[1];
                        paramStart = part.offset + (inlineEnum ? part.text.indexOf(paramName, part.text.indexOf('enum') + 4) : trailingName.index);
                        addRange(typeRanges, line, part.offset, paramStart);
                        const choices = part.text.indexOf('[');
                        if (inlineEnum && choices >= 0) addRange(ignoredRanges, line, part.offset + choices, part.offset + part.text.length);
                    }
                }
                if (paramName) {
                    if (locals.get(symbol.id)?.has(paramName)) {
                        diagnostic(line, paramStart, paramStart + paramName.length, 'duplicate-parameter', `Parameter ${paramName} is declared more than once.`);
                    }
                    addSymbol(paramName, 'parameter', line, paramStart, symbol);
                }
            }
            if (informal) {
                addRange(typeRanges, line, info.raw.indexOf('function') + 'function'.length, nameStart);
            }
            const returnArrow = info.raw.indexOf('->', paramsEnd);
            if (returnArrow >= 0) addRange(typeRanges, line, returnArrow + 2, info.code.length - 1);
            continue;
        }
        match = trimmed.match(/^(unit|require|ref|open|type|record|case)\s+([A-Za-z_]\w*)\b/);
        if (!match || info.indent !== 0) continue;
        const [, kind, name] = match;
        const nameStart = info.raw.indexOf(name, info.raw.indexOf(kind) + kind.length);
        const symbol = addSymbol(name, kind, line, nameStart, null, {
            endLine: endLines.get(line) ?? line,
            description: ['require', 'ref', 'open'].includes(kind) ? quotedDescription(info.code) : precedingDescription(infos, line),
        });
        if (kind === 'record' || kind === 'case') {
            scopes.push({ symbol, indent: info.indent });
            scopeByLine.set(line, symbol);
        }
        if (kind === 'type') {
            const equal = info.raw.indexOf('=', symbol.end);
            if (equal >= 0) addRange(typeRanges, line, equal + 1, info.code.length);
        }
    }

    for (const [name, candidates] of globals) {
        for (const symbol of candidates.slice(1)) diagnostic(symbol.line, symbol.start, symbol.end, 'duplicate-declaration', `Top-level name ${name} is already declared.`);
    }

    // Routine locals live in their owning routine, including names introduced by loops.
    for (const line of meaningful) {
        const info = infos[line];
        if (info.prose || scopeByLine.has(line)) continue;
        const owner = owningScope(line);
        if (!owner) continue;
        const trimmed = info.code.trim();
        let match;
        if (owner.kind === 'record') {
            match = trimmed.match(/^([A-Za-z_]\w*)\s*:\s*(.+)$/);
            if (match) {
                const start = info.raw.indexOf(match[1], info.indentText.length);
                if (locals.get(owner.id)?.has(match[1])) diagnostic(line, start, start + match[1].length, 'duplicate-field', `Field ${match[1]} is declared more than once.`);
                addSymbol(match[1], 'field', line, start, owner);
                addRange(typeRanges, line, info.raw.indexOf(':', start) + 1, info.code.length);
            }
        } else if (['fn', 'case', 'alias-body'].includes(owner.kind)) {
            match = trimmed.match(/^(?:given\s+)?([A-Za-z_]\w*)\s*=(?!=)/d)
                || trimmed.match(/^for\s+([A-Za-z_]\w*)\s+in\b/d)
                || trimmed.match(/^for\s+([A-Za-z_]\w*)\s*=/d)
                || trimmed.match(/^except\s+.+?\s+as\s+([A-Za-z_]\w*)\s*:/d);
            if (match && !locals.get(owner.id)?.has(match[1])) {
                const nameStart = info.indentText.length + match.indices[1][0];
                addSymbol(match[1], 'variable', line, nameStart, owner);
            }
        }
        const contract = trimmed.match(/^contract\s+["']/);
        if (owner.kind === 'port' && contract && !owner.description) owner.description = quotedDescription(info.code);
    }

    const symbolById = new Map(symbols.map(symbol => [symbol.id, symbol]));
    for (const line of meaningful) {
        const info = infos[line];
        if (info.prose) continue;
        const owner = scopeByLine.get(line) || owningScope(line);
        const invocation = invocations.get(line);
        if (invocation) {
            const candidates = globals.get(invocation.name) || [];
            const symbol = candidates.length === 1 && candidates[0].kind === 'alias' ? candidates[0] : undefined;
            occurrences.push({ name: invocation.name, line, start: invocation.start, end: invocation.end, declaration: false, ...(symbol ? { symbolId: symbol.id } : {}) });
            if (!symbol) diagnostic(line, invocation.start, invocation.end, candidates.length > 1 ? 'ambiguous-alias' : 'undefined-alias',
                candidates.length > 1 ? `Alias ${invocation.name} has multiple declarations.` : `${invocation.name}: needs a declared behavior alias.`);
            continue;
        }
        const meta = info.masked.trim().match(/^(covers|bind|ask)\s+/);
        const metaStart = meta ? info.masked.indexOf(meta[1]) + meta[0].length : -1;
        for (const token of info.masked.matchAll(IDENTIFIER)) {
            const name = token[0];
            const start = token.index;
            const end = start + name.length;
            // Keep numeric suffixes and ASCII substrings of unsupported Unicode names
            // out of navigation/rename. Two code units preserve a neighboring surrogate pair.
            if (/[\p{ID_Continue}\u200c\u200d]$/u.test(info.masked.slice(Math.max(0, start - 2), start)) ||
                /^[\p{ID_Continue}\u200c\u200d]/u.test(info.masked.slice(end, end + 2))) continue;
            const declared = declarations.get(`${line}:${start}`);
            if (declared) {
                occurrences.push({ name, line, start, end, declaration: true, symbolId: declared.id });
                continue;
            }
            if (isKeyword(name)) continue;
            if (ignoredRanges.get(line)?.some(([from, to]) => start >= from && start < to)) continue;
            const before = info.masked.slice(0, start).trimEnd();
            const after = info.masked.slice(end);
            // Member names and named arguments cannot be linked reliably without type analysis.
            if (before.endsWith('.') || (/^\s*=(?!=)/.test(after) && /[(,]$/.test(before))) continue;
            let resolved;
            if (meta && start >= metaStart) {
                const expected = EXPECTED_METADATA[meta[1]];
                const candidates = globals.get(name) || [];
                if (candidates.length === 1) resolved = candidates[0];
                metadata.push({ name, line, start, end, keyword: meta[1], expected, symbol: resolved, ambiguous: candidates.length > 1, owner });
                const topBehavior = version === '0.3' && !owner && (nativeBlocks.size > 0 && [...nativeBlocks.keys()].some(item => infos[item].indent === 0) || [...invocations.values()].some(item => !item.owner));
                if (meta[1] === 'covers' && (owner?.kind === 'fn' || topBehavior) && resolved?.kind === 'require') coverage.add(resolved.id);
            } else if (typeRanges.get(line)?.some(([from, to]) => start >= from && start < to)) {
                const candidates = globals.get(name) || [];
                if (candidates.length === 1 && ['type', 'record'].includes(candidates[0].kind)) resolved = candidates[0];
            } else {
                // Record fields are never plain lexical variables, and nested routines do not
                // assume closure semantics for a language whose interpreter is an agent.
                const table = owner && owner.kind !== 'record' ? locals.get(owner.id) : undefined;
                const shadowed = table?.has(name);
                if (shadowed) resolved = table.get(name) || undefined;
                let outerName = false;
                if (owner?.kind === 'alias-body' && !shadowed) {
                    let parent = symbolById.get(owner.parent);
                    while (parent) {
                        if (locals.get(parent.id)?.has(name)) outerName = true;
                        parent = symbolById.get(parent.parent);
                    }
                }
                const candidates = globals.get(name) || [];
                if (!shadowed && !outerName && candidates.length === 1) resolved = candidates[0];
            }
            occurrences.push({ name, line, start, end, declaration: false, ...(resolved ? { symbolId: resolved.id } : {}) });
        }
    }

    for (const meta of metadata) {
        if (!meta.symbol) {
            diagnostic(meta.line, meta.start, meta.end, meta.ambiguous ? 'ambiguous-reference' : 'unresolved-reference',
                meta.ambiguous ? `${meta.name} has multiple declarations.` : `${meta.keyword} refers to undeclared ${meta.expected} ${meta.name}.`);
        } else if (meta.symbol.kind !== meta.expected) {
            diagnostic(meta.line, meta.start, meta.end, 'wrong-reference-kind', `${meta.keyword} needs a ${meta.expected}; ${meta.name} is a ${meta.symbol.kind}.`);
        }
    }

    // Check indentation and simple syntax without pretending to parse arbitrary English or expressions.
    let indentStep = 4;
    if (!isCanonical) {
        for (let i = 1; i < meaningful.length; i++) {
            const previous = infos[meaningful[i - 1]];
            const current = infos[meaningful[i]];
            if (previous.code.trimEnd().endsWith(':') && previous.aliasRhs === undefined && !nativeBlocks.has(meaningful[i - 1]) && current.indent > previous.indent) {
                indentStep = current.indent - previous.indent;
                break;
            }
        }
    }
    const indentLevels = meaningful.length ? [infos[meaningful[0]].indent] : [0];
    for (let index = 0; index < meaningful.length; index++) {
        const line = meaningful[index];
        const info = infos[line];
        const trimmed = info.code.trim();
        if (/\t/.test(info.indentText)) diagnostic(line, 0, info.indentText.length, 'tabs', 'Use spaces for indentation.');
        if (isCanonical && info.indent % 4 !== 0) diagnostic(line, 0, info.indentText.length, 'indent-width', 'Canonical blocks use four spaces per indentation level.');
        if (index > 0) {
            const previousLine = meaningful[index - 1];
            const previous = infos[previousLine];
            // A protected native body satisfies its header's indentation; the next
            // PlainLogic line is compared at the header's original logical level.
            if (info.indent > previous.indent) {
                if (nativeBlocks.has(previousLine)) diagnostic(line, 0, info.indentText.length, 'unexpected-indent', 'This indentation does not match the enclosing PlainLogic block.');
                else if (!previous.code.trimEnd().endsWith(':') || previous.aliasRhs !== undefined) diagnostic(line, 0, info.indentText.length, 'unexpected-indent', 'Indentation can increase only after a block ending in :.');
                else if (info.indent - previous.indent !== indentStep) diagnostic(line, 0, info.indentText.length, 'indent-jump', `Indent this body by ${indentStep} spaces.`);
                indentLevels.push(info.indent);
            } else if (info.indent < previous.indent) {
                while (indentLevels.length > 1 && indentLevels.at(-1) > info.indent) indentLevels.pop();
                if (indentLevels.at(-1) !== info.indent) {
                    diagnostic(line, 0, Math.max(1, info.indentText.length), 'inconsistent-dedent', 'This indentation does not match an enclosing block.');
                    indentLevels.push(info.indent);
                }
            }
        } else if (isCanonical && info.indent !== 0) diagnostic(line, 0, info.indentText.length, 'top-level-indent', 'The document header must start at the beginning of the line.');
        if (info.prose) {
            if (/^>\s*:?\s*$/.test(trimmed)) diagnostic(line, info.indentText.length, info.raw.length, 'empty-prose', 'Describe the behavior after >.');
            if (version === '0.1') diagnostic(line, info.indentText.length, info.indentText.length + 1, 'legacy-prose', 'Prose steps require plainlogic 0.2.');
            const owner = owningScope(line);
            if (isCanonical && !['fn', 'alias-body'].includes(owner?.kind)) diagnostic(line, info.indentText.length, info.raw.length, 'prose-context', 'A prose step belongs inside a function or alias body.');
            continue;
        }
        const counted = countedLoop(info);
        const targetForm = /^target\b/.test(trimmed) && (!['0.1', '0.2'].includes(version) || /^target\s+["']/.test(trimmed));
        const extensionSyntax = info.aliasRhs !== undefined || nativeBlocks.has(line) || invocations.has(line) || targetForm || counted;
        if (extensionSyntax && isCanonical && version !== '0.3') diagnostic(line, info.indentText.length, info.code.length, 'legacy-extension', 'Aliases, native blocks, target context, and counted loops require plainlogic 0.3.');
        if (counted && !counted.valid) diagnostic(line, info.indentText.length, info.code.length, 'counted-loop', 'Use for name = first to last: with one to separator outside strings and brackets.');
        if (targetForm) {
            if (info.indent !== 0 || !/^target\s+(["'])(?:\\.|(?!\1).)+\1\s*$/.test(trimmed)) diagnostic(line, info.indentText.length, info.code.length, 'target', 'Use one top-level target "language/runtime" description.');
            if (meaningful.some(other => other < line && /^target\b/.test(infos[other].code.trim()))) diagnostic(line, info.indentText.length, info.code.length, 'duplicate-target', 'Declare target context once.');
        }
        if (info.aliasRhs !== undefined) continue;
        if (info.unclosed >= 0) diagnostic(line, info.unclosed, info.raw.length, 'unterminated-string', 'Close this string on the same line.');
        const semicolon = info.masked.indexOf(';');
        if (semicolon >= 0) diagnostic(line, semicolon, semicolon + 1, 'semicolon', 'Use one hard-logic statement per line.');
        if (/^(?:(?:async\s+)?(?:fn|port)|record|case|function|if|elif|else|for|while|try|except|finally)\b/.test(trimmed) && !trimmed.endsWith(':')) {
            diagnostic(line, Math.max(info.indentText.length, info.code.length - 1), info.code.length, 'missing-colon', 'This declaration or control block needs a trailing :.');
        }
    }

    if (isCanonical) {
        if (first !== `plainlogic ${version}` || !['0.1', '0.2', '0.3'].includes(version)) diagnostic(header, 0, infos[header].code.length, 'version', 'Use plainlogic 0.1, 0.2, or 0.3 as the first meaningful line.');
        if (meaningful[0] !== header) diagnostic(header, 0, infos[header].code.length, 'header-order', 'Put the plainlogic version before other declarations.');
        const second = meaningful[1];
        const third = meaningful[2];
        if (second === undefined || !/^unit\s+[A-Za-z_]\w*\s*$/.test(infos[second].code.trim())) diagnostic(header, 0, infos[header].code.length, 'missing-unit', 'The second meaningful line must declare unit <Name>.');
        if (third === undefined || !/^state\s+(?:draft|ready)\s*$/.test(infos[third].code.trim())) diagnostic(header, 0, infos[header].code.length, 'missing-state', 'The third meaningful line must declare state draft or state ready.');
        for (const keyword of ['intent', 'scope']) {
            if (!meaningful.some(line => infos[line].indent === 0 && new RegExp(`^${keyword}\\s+["']`).test(infos[line].code.trim()))) {
                diagnostic(header, 0, infos[header].code.length, `missing-${keyword}`, `A canonical document needs a quoted ${keyword}.`);
            }
        }
        if (!symbols.some(symbol => symbol.kind === 'require')) diagnostic(header, 0, infos[header].code.length, 'missing-requirement', 'A canonical document needs at least one require declaration.');
        const topBehavior = [...nativeBlocks.keys()].some(line => infos[line].indent === 0) || [...invocations.values()].some(item => !item.owner);
        if (!symbols.some(symbol => symbol.kind === 'fn') && !(version === '0.3' && topBehavior)) diagnostic(header, 0, infos[header].code.length, 'missing-function', 'A canonical document needs a function or a 0.3 top-level alias/native behavior unit.');
        for (const line of meaningful) {
            if (infos[line].indent === 0 && /^covers\b/.test(infos[line].code.trim()) && !(version === '0.3' && topBehavior)) diagnostic(line, 0, infos[line].code.length, 'covers-context', 'Top-level covers requires a 0.3 top-level alias or native behavior unit.');
        }
        const ready = meaningful.some(line => infos[line].indent === 0 && /^state\s+ready\s*$/.test(infos[line].code.trim()));
        if (ready) {
            for (const symbol of symbols) {
                if (symbol.kind === 'open') diagnostic(symbol.line, symbol.start, symbol.end, 'ready-open', 'A ready document cannot contain an open decision.');
                if (symbol.kind === 'require' && !coverage.has(symbol.id)) diagnostic(symbol.line, symbol.start, symbol.end, 'uncovered-requirement', `${symbol.name} must be covered by a function or top-level behavior before the document is ready.`);
            }
            for (const meta of metadata.filter(item => item.keyword === 'ask')) diagnostic(meta.line, meta.start, meta.end, 'ready-ask', 'Resolve ask before marking the document ready.');
        }
    }

    for (let line = 0; line < infos.length; line++) {
        if (infos[line].nativeBody || !/^\s*#/.test(infos[line].raw)) continue;
        const start = line;
        while (line + 1 < infos.length && !infos[line + 1].nativeBody && /^\s*#/.test(infos[line + 1].raw)) line++;
        if (line > start) folds.push({ start, end: line, kind: 'comment' });
    }
    diagnostics.sort((a, b) => a.line - b.line || a.start - b.start || a.code.localeCompare(b.code));
    folds.sort((a, b) => a.start - b.start || a.end - b.end);
    return { lines, symbols, occurrences, diagnostics, folds, isCanonical, version, opaqueRanges };
}

/** Literal target bodies and alias descriptions never expose PlainLogic editor actions. */
function isOpaquePosition(model, line, column) {
    return model.opaqueRanges?.some(item => item.line === line && item.start <= column && column < item.end) || false;
}

/** Return the unambiguously linked declaration under an identifier, or undefined. */
function symbolAt(model, line, column) {
    // End-inclusive: the cursor resting immediately after an identifier still
    // selects it, matching rename preparation. Occurrences on a line are
    // separated by at least one non-identifier character, so this cannot
    // alias the neighbouring token.
    const occurrence = model.occurrences.find(item => item.line === line && item.start <= column && column <= item.end);
    return occurrence?.symbolId ? model.symbols.find(symbol => symbol.id === occurrence.symbolId) : undefined;
}

/** Return linked occurrences, including the declaration; callers may filter declarations. */
function referencesTo(model, symbol) {
    return model.occurrences.filter(occurrence => occurrence.symbolId === symbol.id);
}

module.exports = { analyze, symbolAt, referencesTo, isOpaquePosition };
