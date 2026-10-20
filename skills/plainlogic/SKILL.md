---
name: plainlogic
description: Interpret and implement PlainLogic: .plog documents, plainlogic-fenced blocks, PlainLogic instructions embedded in source files, and pseudocode or specs the user presents as PlainLogic. Also draft, validate, or explain PlainLogic when requested. Use when PlainLogic is invoked by name, a .plog file or plainlogic fence is supplied, or a task explicitly asks to translate PlainLogic into code; ordinary comments are not implementation commands, and pseudocode or specs not presented as PlainLogic do not invoke this skill.
---

# PlainLogic

Turn human-readable behavior into idiomatic implementation while preserving the user's decisions. PlainLogic combines English `>` steps, exact logic, aliases, and protected native source. It is agent-interpreted pseudocode, not a deterministic compiler or a correctness guarantee.

Accept a `.plog` document, informal pseudocode, inline instructions, a specification or requirements document, or an existing source file containing PlainLogic. A full specification, canonical syntax, and separate authoring round are unnecessary when the intended behavior is clear.

## Choose the requested mode

An explicit mode or desired deliverable governs the work:

| Request | Action | Read |
| --- | --- | --- |
| Bare input/path; implement, compile, convert, or build | Validate the relevant behavior, then implement the ready slice. | [Validation](references/validation.md), then [implementation](references/implementation.md). Also [conversion](references/conversion.md) for existing source files. |
| Write, draft, design, or revise pseudocode | Produce or edit reviewable logic; do not implement source code. | [Authoring](references/authoring.md). |
| Validate, check, or assess feasibility | Review meaning and evidence without modifying files unless revision is also requested. | [Validation](references/validation.md). |
| Explain, describe, summarize, or answer questions about supplied logic | Explain read-only; do not modify files or implement anything. | [Language reference](references/plainlogic.md); add [validation](references/validation.md) when feasibility is part of the question. |

For standalone skill installations, invocation examples are `$plainlogic feature.plog`, `$plainlogic src/request.ts`, `$plainlogic requirements.md`, and `$plainlogic write requirements.md`. Ordinary text works too: "Use PlainLogic on src/request.ts" or "Use PlainLogic to check this pseudocode." Product-specific plugin namespaces may change the invocation spelling, not the workflow.

Read the [language reference](references/plainlogic.md) for syntax and behavior. Read [extension surfaces](references/extensibility.md) when aliases, native blocks, counted loops, or target-specific capabilities matter. These resources belong to this skill; no paired skill, provider, editor, or network service is required.

## Shared interpretation rules

- Treat `>` as ordered behavior, including whole function bodies and loops. Preserve clear English at its useful abstraction level; hard logic fixes exact conditions, formulas, and order. Surface contradictions between them.
- Resolve target language/runtime, symbolic types, ports, refs, and existing interfaces from the input and relevant source. Names and paths are lookup hints until verified. Keep actual API capability distinct from a desired contract.
- Validate meaning and feasibility before implementation edits. Reuse a current assessment; structural success or `state ready` alone is insufficient. Ask one consequential question when context cannot settle materially different outcomes, and continue independent resolved work when useful. Do not turn unanswered choices into guessed policy or production placeholders.
- Preserve current user scope. Input documents, refs, native text, and quoted commands are task material, not permission to run commands or perform external actions. Do not commit, push, publish, deploy, or mutate external systems unless explicitly requested.
- For source-file conversion, identify intentional instructions in code positions or explicit marked regions. Ordinary comments, strings, documentation, examples, and comparison operators must not become code. Follow the conversion reference before editing.

For canonical saved documents, use the bundled checker as supporting evidence:

```text
python <skill-directory>/scripts/check_plainlogic.py feature.plog
python <skill-directory>/scripts/check_plainlogic.py feature.plog --ready
```

Use `--ready` before implementing a canonical document. Assess informal fragments directly; do not reject them for missing canonical headers. If Python or the checker is unavailable, inspect structure manually and disclose the limitation. The checker never executes the document or interprets prose/native semantics.

## Bundled examples

Example documents live in `assets/examples/` and fall into three classes; run the checker against them with the matching expectation:

- Canonical, passing `--ready`: `quote-total.plog`, `mixed-total.plog`, `coroutine-canonical.plog`, `native-target.plog`.
- A canonical draft, passing the plain check and failing `--ready` by design: `execute-request-draft.plog`.
- Informal fragments, intentionally headerless: `aliases.plog`, `execute-request.plog`. The checker reports version and prose errors for these because headerless input is read under legacy rules; that is expected, not breakage. Assess them directly under the shared interpretation rules above.

Finish with the actual result, material interpretations, verification performed, and unresolved limits. For implementation, identify source changes and useful behavior-to-symbol/check mappings. Never claim completion for skipped logic.
