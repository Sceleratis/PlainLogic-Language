# PlainLogic for Visual Studio Code

Write pseudocode that mixes plain-English steps with exact logic. This extension supports the custom PlainLogic 0.2 format, legacy 0.1 documents, and informal function signatures.

    function JSONString executeRequest(string url, enum requestType [GET, POST, DELETE, PUT], object requestBody):
        > Initialize http client
        > Serialize requestBody
        > Send request
        > Return result as serialized JSON string

English steps can contain nested exact logic:

    > For each value in values:
        if value > 0:
            > Add value to total.

## Install locally

From the repository root, with Node.js 22 or later:

    npm ci --ignore-scripts
    npm test
    npm run package

Install the resulting package through **Extensions → … → Install from VSIX**, or:

    code --install-extension dist/plainlogic-0.2.0.vsix

Open a **.plog** file. The extension runs locally without a Python interpreter, language server process, or AI account. The package uses the local identifier **plainlogic-local.plainlogic**.

To develop it, open this repository in VS Code and press **F5** using **Run PlainLogic Extension**. A separate Extension Development Host loads the source directly.

## Editor features

| Feature | Behavior |
| --- | --- |
| Syntax highlighting | Canonical declarations, informal signatures and inline enums, types, strings, comments, and opaque English steps. |
| Snippets | Type **plog**, **fn**, **function**, **step**, **block**, or a metadata keyword, then choose its snippet. |
| Completion | Declared names, local names, keywords, types, and matching requirement/ref/question IDs after **covers**, **bind**, and **ask**. |
| Hover | Declaration signatures, nearby comment descriptions, and keyword help. Hover the **>** marker for prose guidance. |
| Outline and folding | Navigate named declarations and collapse indented logic/prose blocks. |
| Definition, references, highlights | Navigate unambiguously indexed identifiers within the current document. |
| Rename | Rename routines, types, metadata IDs, and indexed locals within the current document. English, comments, and string contents are preserved. |
| Signature help | Parameters for direct, unambiguous calls to declared routines, ports, and records. |
| Source links | Click relative forward-slash file paths in **ref** declarations. A **#Symbol** suffix remains a lookup hint; the link opens the file. |
| Live diagnostics | Local structural checks on unsaved text, with canonical-document readiness and metadata links. |

Commands in the Command Palette:

- **PlainLogic: New Draft** opens an untitled canonical document with editable snippet fields.
- **PlainLogic: Open Language Reference** opens the bundled language reference.

Set **plainlogic.diagnostics.enabled** to false to disable live checks.

## English and structural checks

A **>** step is ordered behavior, not a comment. A trailing colon opens a nested block. Prose may introduce loop variables and describe central behavior without a detailed code expansion.

The extension checks structure and declared links. It does not interpret English, run pseudocode, resolve target-language types, verify source APIs, or prove that the requested behavior is feasible. The separate write-pseudocode, validate-pseudocode, and implement-pseudocode agent skills can use the format; they are not required to use the editor extension.

Informal fragments do not receive missing canonical-header errors. A document that starts with **plainlogic 0.2** or **plainlogic 0.1** opts into canonical checks such as required metadata, duplicate names, requirement coverage, and open questions in a ready document. Editor checks cover a useful structural subset rather than the complete hard-logic grammar.

Navigation and rename use lexical declarations, not type inference or cross-file analysis. Field and parameter rename is unavailable because member accesses and named-argument labels are not resolved. Rename never rewrites prose: if an English sentence mentions a renamed identifier, review that wording yourself. Ambiguous duplicate declarations are not guessed.

For the larger canonical syntax check, the repository also includes an optional Python CLI:

    python tools/check_plainlogic.py examples/mixed-total.plog --ready

This is independent of the live JavaScript checks. It also does not interpret prose or execute the document.

Read [the language reference](docs/plainlogic.md), a [mixed example](examples/mixed-total.plog), the [informal HTTP example](examples/execute-request.plog), or its [canonical draft](examples/execute-request-draft.plog).

## Verification

    npm test
    npm run test:integration

Unit tests exercise scope-aware indexing, navigation ranges, diagnostics, and editor helpers. Grammar tests use the real TextMate and Oniguruma engines. Integration tests run the providers in an isolated VS Code profile and extension directory under the ignored **.vscode-test/** folder. They use the installed VS Code executable; set **VSCODE_EXECUTABLE** to its absolute path if it is not found automatically.

The runtime has no third-party dependencies, executes no document text, and makes no network requests. There is no telemetry. Development dependencies are locked in package-lock.json.
