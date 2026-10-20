<!-- Generated resource; maintained in the source repository. -->

# PlainLogic 0.3 extension surfaces

Use the smallest surface that preserves the requested meaning: English steps for behavior, aliases for reusable body-taking behavior, functions/ports/refs for useful contracts, and native blocks for exact target syntax. These are representational tools; they do not establish that a runtime can satisfy a requirement. Keep rejecting unknown canonical hard syntax outside explicit surfaces so typos are not silently accepted as new semantics.

Version 0.3 also allows symbolic generic types such as Pair[Text] or Result[Order, Failure] in type positions. Their target meaning, arity, and constraints still need a source/native contract. Built-in List[T], Map[K, V], and Set[T] retain their defined arity. Type arguments must themselves be types; calls, runtime expressions, and literal values are not accepted as type parameters. Target-specific generic declarations, lifetimes, constraints, and compile-time syntax belong in native blocks when the common type notation would lose information.

## Behavior aliases

```plainlogic
alias NewThread -> Create and run new coroutine

NewThread:
    for i = 1 to 100:
        > Print i to console
```

This is valid informal input. An alias is a document-local named behavior, not a textual macro, a type alias, or evidence that an API exists. Everything after the first arrow is literal descriptive text, including punctuation, quotes, hashes, or Unicode. Declare aliases at document top level; forward uses are allowed. They share the top-level namespace and cannot duplicate other declarations.

An invocation is a standalone identifier followed by a colon and a required indented body. It can occur at the top level or inside a routine, prose block, or another alias body. Resolve it to one declared alias; do not guess an undeclared or ambiguous name. The body is supplied to that behavior as a unit. Version 0.3 does not define parameterized or value-producing alias calls; use a function, port, English step, or native block for those.

The description governs when and how the body is used. The semantic reviewer must establish material execution count, scheduling, capture, lifetime, failure behavior, and what return/break/continue target. Do not assume synchronous execution, exactly-once execution, or a return from the enclosing routine. The editor gives each alias body a conservative local scope and does not automatically link captured outer values for rename or completion.

NewThread denotes the described coroutine behavior, irrespective of its name. In Lua, coroutines do not imply operating-system threads; the relevant runtime and any resumption policy still need context. Lua and host-specific runtimes such as Luau must not be assumed interchangeable. For target facts, inspect the selected runtime's primary documentation; the [Lua 5.4 coroutine reference](https://www.lua.org/manual/5.4/manual.html#2.6) is an example.

## Inclusive counted loops

```plainlogic
for i = first to last:
    > Process i
```

Evaluate first, then last, once each before entering the loop. Count upward by one, include both endpoints, and perform no iterations if first is greater than last. Assign each integer to the loop variable before its body. The variable belongs to the containing logical scope and retains its last assigned value after an executed loop; an empty loop makes no assignment. Descending/custom-step loops and target-specific iteration remain expressible through prose or native blocks. The to separator is recognized outside strings and nested brackets. Names such as total and strings containing " to " do not split the loop.

The tools do not prove integer bounds or target numeric compatibility. This is PlainLogic syntax, not a claim that the target writes its loops this way.

## Protected native blocks

```plainlogic
target "lua 5.4"

native "lua":
    local values = {1, 2, 3}
    for _, value in ipairs(values) do
        print(value)
    end
```

Allow native blocks at document top level for imports, declarations, interfaces, attributes, macros, or other target syntax, as well as inside routine, alias, or prose bodies for statements. The quoted language label is descriptive data; a simple unquoted label such as native lua: is also accepted. It is never a command, plugin, or executable selector. Optional target metadata is one quoted document-level description of the language/runtime/version. Mixed-language blocks are allowed when deliberate; reconcile the interfaces and target context during semantic validation.

Every nonblank native-body line retains a container margin of four spaces beyond its header. Strip only that margin when adapting the literal content; preserve all remaining target text, internal indentation, tabs, comments, strings, braces, and punctuation. A nonblank line dedented to the header level ends the block. Blank lines stay inside it. Target text cannot switch back to PlainLogic through a colon, quote, keyword, arrow, or greater-than marker.

Native content bypasses PlainLogic tokenization, diagnostics, identifier indexing, completion, navigation, and rename. Only its header, margin, and extent are checked/folded. Highlighting marks a protected target-code region and does not promise target-specific IntelliSense. Neither tool executes it, selects a compiler, loads plugins, or validates target grammar. Review target syntax, scope/value flow, effects, and surrounding requirements before adapting it. Compile/test resulting code only within the implementation task's authorization.

Names introduced in native code are not silently imported into PlainLogic's symbol table. Preserve their visible meaning during implementation; automatic editor rename cannot establish those cross-boundary relationships. Do not let exact target text silently override conflicting English or hard logic.

## Canonical top-level behavior

In 0.3, a canonical document needs at least one function, top-level alias invocation, or top-level native block. A top-level covers R1, R2 line declares requirement coverage for top-level alias/native behavior and requires such a unit. Functions retain their own covers lines. Coverage is a declaration, not semantic evidence. Informal fragments still need no metadata.

```plainlogic
plainlogic 0.3
unit CoroutineExample
state ready
target "lua 5.4"
intent "Print integers 1 through 100 inside a newly created and started coroutine."
scope "One body, no yielding, extra scheduler, or native OS thread."
require R1 "Create and start a coroutine whose body prints each integer 1 through 100 once."
covers R1
alias NewThread -> Create and run new coroutine

NewThread:
    for i = 1 to 100:
        > Print i to console
```

The scope above supplies example-specific decisions; do not assume them for every coroutine alias.

## Capability audit and routing

| Target feature | Representation | Material points to validate |
| --- | --- | --- |
| Coroutines, async tasks, yields, generators | Behavior alias, prose, or native block | Scheduling, resumption, completion, cancellation, errors. |
| Callbacks, closures, methods, events | Prose, function/port contracts, native declarations | Capture, receiver, invocation count, lifetime, reentrancy. |
| Cleanup, disposal, locks, transactions | Prose/alias scope, existing ports, native control | Ownership, cleanup on failures/early exits, actual atomicity guarantees. |
| Multiple returns, destructuring, optional/variadic arguments | Native syntax, prose, or an explicit portable record | Value count/order; do not silently force one return or invent defaults. |
| Patterns, switch/match, comprehensions, custom iteration | Prose/native blocks | Matching order, exhaustiveness, iteration bounds and side effects. |
| Classes, interfaces, traits, generics, decorators, macros, imports | Top-level native blocks and refs | Target/version support, compile-time effects, generated interfaces. |
| Pointers, references, mutable state, binary/FFI values | Symbolic types/contracts and native syntax | Representation, aliasing, ownership, lifetimes, encoding, ABI. |
| Numeric, string, nil/null, identity, collection differences | Explicit requirements, symbolic types, native operations | Precision/overflow, indexing, truthiness, ordering, missingness. |
| Platform/host libraries or embedded languages | Target context, ports/refs, native blocks | Verify actual capability and cross-language interface; missing context is not impossibility. |

This checklist routes capability gaps rather than adding every language's syntax to PlainLogic. Check only what matters to the requested behavior. If a platform cannot supply a promised guarantee, adding an alias or native block does not solve that contradiction. Ask one consequential question when needed, preserve unresolved decisions, and continue independent resolved work.
