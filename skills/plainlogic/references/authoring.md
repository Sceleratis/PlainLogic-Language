# Authoring reviewable logic

Use this mode when the requested result is pseudocode, a refined logic document, or an agent handoff. Work from the feature or routine the user can describe now; a complete project specification is unnecessary. Do not edit implementation source unless implementation is also requested.

Extract the outcome, inputs/outputs, decisions, effects, relevant existing behavior, and exclusions from the supplied material. Inspect source only where it settles the requested logic. Keep provenance brief through verified `ref` locators or a short explanation of material interpretations. Do not invent paths, APIs, types, or business rules to complete a document.

Write a `.plog` document or `plainlogic` fenced block using the bundled language version, currently 0.3. Saved canonical documents use a concise intent and scope, stable requirement IDs, named routines, and `covers` declarations. Informal reviews and small edits can retain the user's understandable style, including return-first function signatures. Preserve inline enum choices, output types, and behavior when normalizing. Add records and ports only when they clarify the contract.

Use ordered `>` sentences for behavior the user prefers to describe in English. They may describe central logic, whole loops, or an entire function body, and can mix with precise branches and assignments. A trailing colon opens a nested prose block. Do not force clear English into detailed code or a port. Use exact logic when the user supplies it or a boundary, formula, or ordering decision needs precision. Expose conflicts between exact logic and prose instead of silently selecting one.

For example, this is valid informal input:

```plainlogic
function JSONString executeRequest(string url, enum requestType [GET, POST, DELETE, PUT], object requestBody):
    > Initialize http client
    > Serialize requestBody
    > Send request
    > Return result as serialized JSON string
```

This records an intended operation; response shape, request-body rules, and failure behavior may still need existing context or a focused question. Do not invent these policies merely to normalize the syntax.

Use `open Q1 "..."` and `ask Q1` when a missing decision changes observable behavior, and keep the document `state draft`. Ordinary implementation choices that source can settle are not unanswered business rules. Ask focused questions while continuing independent resolved logic. Never hide a missing choice inside "validate correctly," a vague port, a guessed default, or an example that quietly establishes new policy.

Add small `case` scenarios when they illuminate branches, boundaries, or effects. Use explicit fixtures or port stubs when outside state matters. Cases are candidate checks, not proof. They must not silently introduce unrequested requirements.

Read [extension surfaces](extensibility.md) when the common syntax loses target behavior. Use aliases for reusable body-taking behavior, meaningful prose or contracts for high-level requirements, and protected native blocks for exact target syntax. Preserve multiple returns, capture, scheduling, ownership, and lifetime where material. An alias description does not establish an API or scheduler.

Check canonical saved documents with the bundled structural checker. Use `--ready` only when behavior-affecting questions are resolved. Informal fragments need direct assessment rather than mandatory canonicalization. A structural pass does not establish semantic correctness; apply [validation](validation.md) when feasibility or consequential ambiguity needs assessment. Do not interview the user about clear prose.

For revisions, preserve stable routine and requirement names when their meaning is unchanged. Explain the behavioral delta and unresolved choices. Preserve rough originals when normalization might obscure intent. For handoffs, include the relevant repository/target, permitted slice, verified source references, and focused verification needs. A handoff document does not authorize sending it to another chat or service. If implementation is also requested, continue into that workflow when the necessary slice is ready.
