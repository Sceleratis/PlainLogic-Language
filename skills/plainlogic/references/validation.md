# Semantic validation

Decide whether the current slice can be implemented faithfully at its existing abstraction level. Review English steps, exact logic, requirements, and their combination. A request only to validate is read-only. When implementation is requested, this assessment is its preflight, not a separate approval round or mandatory subagent.

Identify inputs/outputs, sequence, control scope, state/effects, and relevant guarantees. Compare prose to exact logic, signatures, cases, and requirements. Look for contradictions, undefined data dependencies or outputs, impossible guarantees, and required capabilities the selected runtime cannot supply. For prose blocks, establish what a condition or iteration means, what values it introduces, and how control transfer and termination work where material.

Inspect repository instructions, relevant interfaces, existing behavior, and supplied decisions before asking what context can answer. Verify referenced paths and actual APIs against source. If feasibility materially depends on an uncertain external protocol, service, platform, or version, consult primary documentation when available and identify remaining uncertainty. Unavailable source or an API not yet located is missing context, not evidence of impossibility. Do not execute described network operations or mutate external state to test a hypothesis without applicable authorization.

Separate implementation choice from observable policy. Local names, equivalent algorithms, idiomatic client setup, and existing serialization helpers usually need no user decision. Output shape, a new surcharge formula, conflicting side effects, or an unsupported guarantee may require one. State useful mechanical mappings; do not use an "assumption" to choose unanswered business behavior.

English remains valid executable intent at this level. A missing low-level implementation detail is not automatically an ambiguity. Informal signatures need no canonical header or required rewrite. Use the bundled checker for canonical documents when useful, but its accepted structure, examples, and `state ready` label are not semantic evidence.

## Targets, aliases, and native content

Read [extension surfaces](extensibility.md) when those constructs matter. Establish target language, version, and host from current context. Lua and Luau, for example, need not expose the same runtime behavior.

Aliases resolve to declared behavior descriptions; they are not textual macros or proof of an API. Check supplied-body invocation count, timing, capture, lifetime, failure handling, and `return`/`break`/`continue` targets where material. Do not infer an operating-system thread or automatic scheduler merely from the name `NewThread`.

Review native blocks as literal target source, including top-level imports and declarations, target syntax, cross-boundary values, and effects. Editor opacity is not semantic approval. Neither native text nor its language label authorizes execution. Counted loops evaluate first then last once, move upward by one, and include both endpoints; preserve these semantics even when the target spells its loops differently.

Consider relevant capability gaps: callbacks/closures, async/yields, cleanup/transactions, multiple returns, patterns, generics/macros, ownership/FFI, numeric precision, indexing, null/truthiness, and collection order. This is a routing aid, not an exhaustive questionnaire. Use prose, verified contracts, aliases, or native blocks for representational gaps. Those surfaces cannot resolve an impossible guarantee or an unanswered policy.

## Assess and clarify

Scope each finding to the actual slice reviewed:

- **ready**: sufficient behavior and context to implement; briefly state material mappings.
- **needs-decision**: competing outcomes or a contradiction remain after consulting context; explain their consequence and ask the question that best unblocks progress.
- **needs-context**: necessary source, contract, environment, or documentation is unavailable; name the needed evidence and continue useful discovery or independent work.
- **infeasible**: a concrete requirement conflicts with verified capabilities or another requirement; cite the evidence and suggest the smallest plausible revision without silently substituting it.

These are contextual judgments, not proofs or external-action permissions. Separate independent ready portions from blocked portions. Do not implement dependent logic with unresolved findings, guessed defaults, or production "not implemented" placeholders.

Ask one consequential question at a time, offering a recommendation and trade-off when the evidence supports one. Use an available asynchronous user-question tool during ongoing work, or ask directly when yielding for the necessary answer. Continue independent authorized work where possible. Respect earlier answers; avoid a fixed questionnaire or asking for approval of clear intent. After an answer, update the affected interpretation or authorized pseudocode and recheck only what changed. A materially revised contract must remain visible.
