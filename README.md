# PlainLogic

Write pseudocode that mixes plain-English steps with exact logic. This extension supports custom PlainLogic 0.3, legacy 0.1/0.2 documents, and informal function signatures.

The **PlainLogic** agent skill translates that logic, requirements documents, or intentional PlainLogic regions in source files into implementation code. The VS Code extension supplies editor features; the agent skill performs interpretation and implementation.

    function JSONString executeRequest(string url, enum requestType [GET, POST, DELETE, PUT], object requestBody):
        > Initialize http client
        > Serialize requestBody
        > Send request
        > Return result as serialized JSON string

English steps can contain nested exact logic:

    > For each value in values:
        if value > 0:
            > Add value to total.

Name reusable behavior with an alias:

    alias NewThread -> Create and run new coroutine

    NewThread:
        for i = 1 to 100:
            > Print i to console

The counted loop includes both endpoints. Alias meaning is reviewed against the selected runtime; the name does not prescribe a threading API.

For exact target features outside the common syntax, use a protected block:

    native "lua":
        local values = {1, 2, 3}
        for _, value in ipairs(values) do
            print(value)
        end

Native blocks work at document top level for declarations/imports and inside logic for statements. Their target text remains opaque to PlainLogic tooling. See [extension surfaces and the capability audit](docs/extensibility.md).

## Use PlainLogic with an agent

The repository includes a portable Agent Plugins package and a self-contained Agent Skill, with Codex and Claude Code compatibility manifests sharing one maintained workflow.

From the repository root, install with your client:

    codex plugin marketplace add .
    codex plugin add plainlogic@plainlogic-local

or:

    claude plugin marketplace add .
    claude plugin install plainlogic@plainlogic-local

These commands install the plugin in that client's configuration. The files are also usable as a standalone Agent Skill. See [agent installation and portability](docs/agents.md) for direct skill paths, GitHub sources, and session-only Claude loading.

Example prompts for a standalone skill:

    $plainlogic feature.plog
    $plainlogic docs/requirements.md
    $plainlogic src/request.lua
    $plainlogic write docs/requirements.md
    $plainlogic validate feature.plog

For a Codex plugin, select **PlainLogic** from the skill picker or say **Use PlainLogic on src/request.lua**. Claude Code's plugin uses **/plainlogic:plainlogic**; a standalone Claude skill uses **/plainlogic**. Bare input means validate then implement. Explicit writing or validation requests retain their scope.

To mark instructions within an existing source file, use its comment syntax:

    def sum_positive(values):
        # plainlogic:start
        # > Return the sum of strictly positive values, or zero when none qualify.
        # plainlogic:end

Calling PlainLogic on that file replaces the region with implementation code and preserves the native function interface and unrelated source. Ordinary comments, strings, docs, examples, and comparison operators are not converted. Specs and .plog inputs are preserved by default while their mapped implementation files are created or updated.

## Install the VS Code extension

From the repository root, with Node.js 22 or later:

    npm ci --ignore-scripts
    npm test
    npm run package

Install the resulting package through **Extensions → … → Install from VSIX**, or:

    code --install-extension dist/plainlogic-0.3.0.vsix

Open a **.plog** file. The extension runs locally without a Python interpreter, language server process, or AI account. The package uses the local identifier **plainlogic-local.plainlogic**.

To develop it, run **code --extensionDevelopmentPath="<absolute-path-to-this-repository>"**. A separate Extension Development Host loads the source directly. Editor launch configurations are local and ignored by Git.

## Editor features

| Feature | Behavior |
| --- | --- |
| Syntax highlighting | Canonical/informal signatures, English steps, behavior aliases, counted loops, and protected native regions. |
| Snippets | Type **plog**, **fn**, **function**, **step**, **block**, or a metadata keyword, then choose its snippet. |
| Completion | Declared names, local names, keywords, types, and matching requirement/ref/question IDs after **covers**, **bind**, and **ask**. |
| Hover | Declaration signatures, nearby comment descriptions, and keyword help. Hover the **>** marker for prose guidance. |
| Outline and folding | Navigate named declarations and collapse indented logic/prose blocks. |
| Definition, references, highlights | Navigate unambiguously indexed identifiers within the current document. |
| Rename | Rename routines, aliases, types, metadata IDs, and indexed locals in the current document. English, alias descriptions, native content, comments, and strings are preserved. |
| Signature help | Parameters for direct, unambiguous calls to declared routines, ports, and records. |
| Source links | Click relative forward-slash file paths in **ref** declarations. A **#Symbol** suffix remains a lookup hint; the link opens the file. |
| Live diagnostics | Local structural checks on unsaved text, with canonical-document readiness and metadata links. |

Commands in the Command Palette:

- **PlainLogic: New Draft** opens an untitled canonical document with editable snippet fields.
- **PlainLogic: Open Language Reference** opens the bundled language reference.

Set **plainlogic.diagnostics.enabled** to false to disable live checks.

## English and structural checks

A **>** step is ordered behavior, not a comment. A trailing colon opens a nested block. Prose may introduce loop variables and describe central behavior without a detailed code expansion.

The extension checks structure and declared links. It does not interpret English, run pseudocode, resolve target-language types, verify source APIs, or prove feasibility. The **PlainLogic** skill handles authoring, validation, implementation, and source conversion. The editor extension and agent skill can be used independently.

Informal fragments do not receive missing canonical-header errors. A document that starts with **plainlogic 0.3**, **0.2**, or **0.1** opts into canonical checks such as metadata, duplicate names, requirement coverage, and open questions in a ready document. Editor checks cover a structural subset rather than the complete hard-logic grammar. New extension forms require 0.3 in canonical documents.

Navigation and rename use lexical declarations, not type inference or cross-file analysis. Field and parameter rename is unavailable because member accesses and named-argument labels are not resolved. Rename never rewrites prose, alias descriptions, or native text: review any references there yourself. Alias-body locals are isolated conservatively; captured outer values and native-defined names are not inferred. Ambiguous declarations are not guessed.

The extensibility audit covers callbacks/closures, async/generators, cleanup/lifetimes/transactions, patterns, multiple returns, variadic arguments, generics/macros/decorators, binary/FFI values, and target numeric/runtime differences. Prose, aliases, contracts, and native blocks can represent those needs without adding every target keyword to the common parser. Their semantics and actual platform feasibility still need validation. An unsupported canonical hard statement should be expressed explicitly through one of those surfaces.

For the larger canonical syntax check, the repository also includes an optional Python CLI:

    python tools/check_plainlogic.py examples/mixed-total.plog --ready

This is independent of the live JavaScript checks. It also does not interpret prose or execute the document.

Read [the language reference](docs/plainlogic.md), a [mixed example](examples/mixed-total.plog), the [informal HTTP example](examples/execute-request.plog), or its [canonical draft](examples/execute-request-draft.plog).

## Verification

    npm test
    npm run test:checker
    npm run test:integration

For the portable skill/plugin resources and distribution:

    npm run agents:sync
    npm run agents:check
    npm run test:agent-build
    npm run package:agents

The agent package builder uses Python's standard library. It produces a portable plugin ZIP and a standalone skill ZIP under **dist/**. The checked-in generated language/checker/example resources make a cloned plugin usable without running a build. Regenerate those resources after editing their maintained sources; the check command reports drift without writing.

Unit tests exercise indexing, navigation ranges, diagnostics, opaque regions, and editor helpers. Grammar tests use real TextMate and Oniguruma. The optional Python checker suite requires Python and is separate from editor/runtime dependencies. Integration tests run the providers in an isolated VS Code profile and extension directory under the ignored **.vscode-test/** folder. They use installed VS Code; set **VSCODE_EXECUTABLE** to its absolute path if it is not found automatically.

The runtime has no third-party dependencies, executes no document text, and makes no network requests. There is no telemetry. Development dependencies are locked in package-lock.json.
