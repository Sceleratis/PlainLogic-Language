# Gold conversion pairs

Each directory pairs one canonical document from `examples/` with reference
implementations in several target languages. They exist for two reasons:

- **Anchors for agents.** Rules describe PlainLogic; these pairs show what a
  faithful, idiomatic conversion looks like per target — record mapping,
  identifier casing, division semantics, and how much restructuring is
  faithful (a loop may become `sum`/`reduce`) versus a behavior change.
- **An eval corpus.** When the skill's guidance changes, re-run conversions
  of these documents and diff against the gold files; then regenerate the
  case tests (`tools/case_to_tests.py`) and run them against each
  implementation.

Every file starts with mapping notes calling out the non-obvious choices.
Verification: all three implementations are executed against the
documents' own cases (`test/gold_conversions_test.py`) — Python against
tests generated from the cases, TypeScript under Node's type stripping,
and C# compiled and run under the .NET SDK when one is available (the C#
check skips cleanly on machines without an SDK).
