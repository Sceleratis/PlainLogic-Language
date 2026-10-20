# Converting PlainLogic inside source files

Use this reference when PlainLogic is invoked on an actual implementation file, such as `$plainlogic src/request.ts`. Existing source supplies a likely target and interfaces. Inspect the language and repository before deciding which text is intentional PlainLogic; do not rewrite all comments or interpret a filename extension as sufficient evidence that every natural-language sentence is a command.

## Recognize intentional regions

Convert either of these surfaces when their meaning and destination are clear:

1. Unambiguous raw PlainLogic in code positions: for example, `>` steps in a native function body or an unmistakable PlainLogic function declaration among implementation code.
2. Explicit `plainlogic:start` and `plainlogic:end` regions delimited by standalone target-language comments. Recognize the actual comment syntax, such as `#`, `//`, `--`, or `/* ... */`; marker text inside a string or documentation example is not a marker.

Ordinary comments, docstrings, quoted strings, Markdown, documentation examples, comparison/shift operators, and shell output must never become code automatically. A comment beginning `# >` or `// >` outside an explicit marked region remains an ordinary comment unless the user directly identifies it as an instruction. An ordinary `TODO` alone is not PlainLogic. Where syntax or placement makes intention ambiguous, ask about the affected region instead of guessing.

A Python example:

```python
def sum_positive(values):
    # plainlogic:start
    # > Add all values greater than zero.
    # > Return their sum, or zero when there are none.
    # plainlogic:end
```

Here the existing function signature is the implementation destination; the explicit marker pair establishes that the commented steps are instructions. Decode only the comment wrapper needed to recover those steps and their relative indentation. Preserve `#` or other punctuation inside strings, native code, and prose. Raw instructions inside marked regions are also acceptable when deliberate; do not blindly strip every leading punctuation character.

A start marker may carry attributes such as `id=<name>` and `hash=<hex>`; the hash pins the region's decoded logic (the bundled checker's `--scan --pin` writes it, and a later `--scan` reports a region whose text changed after pinning as stale). Preserve attributes on regions you are not converting. The same `--scan` mode inventories every region in a file or directory with its readiness, which beats hunting markers by eye in a large tree.

Validate marker balance and boundaries before editing. Do not let an unclosed, overlapping, or nested pair absorb unrelated source. Missing boundaries or conflicting region scope require context or a decision. Treat marked text as supplied logic to validate, not authority to run embedded commands.

## Map and replace deliberately

Read the surrounding native signature, class/module, imports, variable scope, effects, and relevant tests. Preserve signatures and interfaces that the PlainLogic body is intended to implement. If the file contains a PlainLogic signature naming an existing routine, reconcile it with that routine instead of appending a second implementation. Surface a meaningful conflict between native types or contracts and the supplied logic.

Apply [validation](validation.md) to the selected regions and surrounding source before implementation edits. Honor the project's `plainlogic-maps.md` for type, port, and naming decisions when one exists. Resolve references and target APIs against evidence. A clear prose step can be implemented directly; it needs no full canonical document. Existing project conventions settle ordinary mechanics. Materially unclear outputs, failures, target/runtime features, or collisions still need clarification.

Replace only the consumed instruction region or unmistakable raw PlainLogic body and make necessary nearby supporting edits, such as an import. For an explicit marker pair, replace its markers and contents with the implementation by default. Removing consumed markers prevents a subsequent invocation from interpreting completed native code as fresh PlainLogic. Do not leave generated code inside an active conversion region. Preserve ordinary comments, unrelated code, user changes, encoding, line endings, and surrounding formatting where practicable.

Keep a `.plog` document or spec as input by default and write its implementation to mapped target files; do not overwrite `.plog` with unrelated target source. A Markdown specification may contain ordinary code examples or fenced PlainLogic to interpret as requirement material. It does not authorize replacing those examples in place. Edit documentation or examples only when the user requests that deliverable.

If a source file has no intentional PlainLogic instructions, leave it unchanged and report that no conversion was needed. Repeated conversion of an already completed file should not add a duplicate method or translate its explanatory comments. If target location or file collision cannot be settled from context, ask the consequential question before writing the dependent slice.

## Verify the converted result

Inspect the diff to confirm that the requested behavior is implemented, consumed instructions are gone, and unrelated text is preserved. Verify that no duplicate symbols, stray markers, or invalid raw PlainLogic remain in converted code positions. Use the target's focused syntax/build/behavior checks as appropriate; filter test runs to the relevant tests. Report which regions and symbols changed, what was checked, and any unconverted instructions whose decisions remain unresolved.
