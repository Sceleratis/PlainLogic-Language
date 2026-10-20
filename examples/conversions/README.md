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
Verification: the Python and TypeScript implementations are executed
against tests generated from the documents' own cases
(`test/gold_conversions_test.py`); the C# files are reviewed by inspection
(no .NET SDK in the test environment).
