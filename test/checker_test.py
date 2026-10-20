"""Regression checks for the optional, non-executing canonical Python checker."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


sys.dont_write_bytecode = True
CHECKER = Path(__file__).resolve().parents[1] / "tools" / "check_plainlogic.py"
spec = importlib.util.spec_from_file_location("plainlogic_checker_under_test", CHECKER)
checker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = checker
spec.loader.exec_module(checker)


def document(*parts: str, version: str = "0.3", state: str = "ready") -> str:
    return "\n".join([
        f"plainlogic {version}", "unit Example", f"state {state}",
        'intent "Describe one behavior."', 'scope "Only the requested behavior."',
        'require R1 "Perform the behavior."', *parts,
    ])


def routine(body: str, *, extra: str = "", version: str = "0.3", state: str = "ready") -> str:
    return document(extra, "fn run() -> None:\n    covers R1\n" +
                    textwrap.indent(textwrap.dedent(body).strip(), "    "),
                    version=version, state=state)


class CheckerTests(unittest.TestCase):
    def errors(self, source: str, **kwargs) -> list[str]:
        return [entry.message for entry in checker.check_text(source, **kwargs) if entry.severity == "error"]

    def assert_clean(self, source: str, **kwargs) -> None:
        self.assertEqual(self.errors(source, **kwargs), [])

    def assert_error(self, source: str, fragment: str) -> None:
        self.assertTrue(any(fragment in error for error in self.errors(source)), self.errors(source))

    def test_legacy_exact_logic_versions_remain_supported(self):
        for version in ("0.1", "0.2", "0.3"):
            with self.subTest(version=version):
                self.assert_clean(routine("""
                    total = 0
                    for value in range(1, 4):
                        if value > 0:
                            total = total + value
                    return None
                """, version=version), ready=True)

    def test_legacy_prose_gate_and_mixed_prose(self):
        self.assert_error(routine("> Do the behavior.", version="0.1"), "prose steps require")
        for version in ("0.2", "0.3"):
            self.assert_clean(routine("""
                > For each input:
                    if value > 0:
                        > Add it to the total, including # and an unmatched quote '
                    break
            """, version=version))

    def test_legacy_new_keyword_identifiers_do_not_bypass_token_checks(self):
        for version in ("0.1", "0.2"):
            self.assert_clean(document('''fn native() -> Int:
    covers R1
    alias = 1
    return alias
fn run() -> None:
    covers R1
    native()
    return None''', version=version))
        self.assert_error(routine("alias = 1; alias = 2", version="0.2"), "semicolon-separated")
        self.assert_error(routine("alias = 1; alias = 2"), "semicolon-separated")

    def test_alias_description_is_opaque_after_first_arrow(self):
        self.assert_clean(routine("""
            NewThread:
                > Print a result.
        """, extra='alias NewThread -> Create → run; include #, ->, " and [ any text'))

    def test_root_alias_forward_declaration_and_counted_loop(self):
        self.assert_clean(document("covers R1", """NewThread:
    for i = 1 to 100:
        > Print i to console
alias NewThread -> Create and run new coroutine"""), ready=True)

    def test_alias_nested_in_prose_and_another_alias(self):
        self.assert_clean(routine("""
            > If enabled:
                Outer:
                    Inner:
                        break
                        continue
                        return None
        """, extra="alias Outer -> Run the supplied body\nalias Inner -> Use body as a loop"))

    def test_alias_invocation_must_be_declared(self):
        self.assert_error(routine("Missing:\n    return None"), "unknown or ambiguous alias 'Missing'")

    def test_alias_requires_body(self):
        self.assert_error(document("covers R1", "alias Run -> Use body", "Run:"), "indented body")
        self.assert_error(routine("Run:\nreturn None", extra="alias Run -> Use body"), "invalid routine syntax")

    def test_alias_declaration_is_top_level_only(self):
        self.assert_error(routine("alias Run -> Use body\nreturn None"), "invalid routine syntax")

    def test_alias_declaration_cannot_have_a_body(self):
        self.assert_error(routine("return None", extra="alias Run -> Use body\n    > Run body."),
                          "alias declarations cannot have an indented body")

    def test_alias_cannot_be_parameterized_or_used_as_value(self):
        for body in ("Run(1):\n    return None", "result = Run()", "Run()"):
            with self.subTest(body=body):
                self.assertTrue(self.errors(routine(body, extra="alias Run -> Use body")))
        self.assert_error(routine("return None", extra="alias Run(value) -> Use body"),
                          "unsupported or malformed top-level")

    def test_duplicate_alias_and_shared_namespace_are_ambiguous(self):
        for extra in ("alias Run -> First\nalias Run -> Second",
                      'ref Run "source.py#Run"\nalias Run -> Use body',
                      'alias Run -> Use body\nref Run "source.py#Run"'):
            with self.subTest(extra=extra):
                source = routine("Run:\n    return None", extra=extra)
                self.assert_error(source, "duplicate name 'Run'")
                self.assert_error(source, "unknown or ambiguous alias 'Run'")

    def test_alias_needs_nonempty_description_and_valid_name(self):
        for extra in ("alias Run ->", "alias Run", "alias 9Run -> Use body", "alias native -> Use body"):
            with self.subTest(extra=extra):
                self.assertTrue(self.errors(routine("return None", extra=extra)))

    def test_alias_body_cannot_gain_python_else(self):
        self.assert_error(routine("""
            Run:
                return None
            else:
                return None
        """, extra="alias Run -> Use body"), "alias invocations cannot have an else")

    def test_native_accepts_opaque_target_syntax_and_tabs_after_margin(self):
        source = document("covers R1", 'target "lua 5.4"', '''native "lua":
    local values = {1, 2}; -- target comment
    \tprint("unbalanced
    > literal # -> native "never ends the block":
    alias Pretend -> This is target text
    fn fake() -> None:
    """ multiline target content ''')
        self.assert_clean(source)

    def test_native_can_be_nested_in_function_alias_and_prose(self):
        self.assert_clean(routine("""
            Run:
                > If requested:
                    native lua:
                        coroutine.yield(1)
                return None
        """, extra="alias Run -> Run supplied body"))

    def test_native_extent_ends_on_dedent_and_hard_logic_is_checked(self):
        self.assert_error(routine('native lua:\n    print("x")\nunknown_api()'),
                          "call 'unknown_api' must name")
        self.assert_clean(routine('native lua:\n    print("x")\nreturn None'))

    def test_native_body_needs_nonblank_text(self):
        self.assert_error(document("covers R1", "native lua:\n\n    \n"), "nonempty literal body")
        self.assert_error(routine("native lua:\nreturn None"), "nonempty literal body")

    def test_native_container_margin_requires_four_spaces(self):
        for body in ("  print(1)", "\tprint(1)", " \tprint(1)"):
            with self.subTest(body=body):
                self.assert_error(document("covers R1", "native lua:\n" + body), "container margin")
        self.assert_error(routine("native lua:\n  print(1)"), "container margin")

    def test_native_inner_indent_is_not_plainlogic_indent(self):
        self.assert_clean(document("covers R1", "native lua:\n    if x then\n      print(x)\n    end"))

    def test_native_header_requires_nonempty_label_and_colon(self):
        for header in ('native "":', "native:", "native lua", 'native "lua" + "python":',
                       'native "unfinished:', "native lua;python:", "native $lua:"):
            with self.subTest(header=header):
                self.assert_error(document("covers R1", header + "\n    print(1)"), "native header")

    def test_native_body_cannot_gain_python_else(self):
        self.assert_error(routine('native lua:\n    print(1)\nelse:\n    return None'),
                          "native blocks cannot have an else")

    def test_native_not_allowed_in_contract_or_record(self):
        self.assert_error(routine("return None", extra='''record Value:
    native lua:
        type Any = any'''), "native blocks are allowed only")

    def test_native_names_are_not_imported(self):
        self.assert_error(routine('native lua:\n    function compute() end\ncompute()'),
                          "call 'compute' must name")

    def test_target_metadata_is_optional_quoted_unique_and_versioned(self):
        self.assert_clean(routine("return None", extra='target "Lua 5.4 / host-specific runtime"'))
        for extra in ('target lua', 'target ""', 'target "lua"\ntarget "luau"'):
            with self.subTest(extra=extra):
                self.assertTrue(self.errors(routine("return None", extra=extra)))

    def test_symbolic_generic_type_metadata_in_version_03(self):
        self.assert_clean(document('''fn pair(first: Text, second: List[Box[Int]]) -> Pair[Text, Box[Int | None]]:
    covers R1
    native typescript:
        return { first, second };'''))
        for version in ("0.1", "0.2"):
            self.assert_error(document('''fn pair() -> Pair[Text]:
    covers R1
    return None''', version=version), "unsupported type")
        for value_type in ("Pair[1]", "Pair[compute()]", "Pair[*Types]", "Pair[()]",
                           "List[Text, Int]", "Map[Text]", "Set[Int, Text]", "Text[Int]"):
            with self.subTest(value_type=value_type):
                self.assert_error(document(f"fn pair() -> {value_type}:\n    covers R1\n    return None"),
                                  "unsupported type")

    def test_new_surfaces_are_rejected_in_each_legacy_version(self):
        for version in ("0.1", "0.2"):
            for body, extra, message in (
                ("return None", "alias Run -> Use body", "behavior aliases require"),
                ("Run:\n    return None", "", "alias invocations require"),
                ('native lua:\n    print(1)', "", "native blocks require"),
                ("for i = 1 to 2:\n    return None", "", "counted loops require"),
                ("return None", 'target "lua"', "target metadata requires"),
                ("return None", "covers R1", "top-level covers requires"),
            ):
                with self.subTest(version=version, message=message):
                    self.assert_error(routine(body, extra=extra, version=version), message)

    def test_counted_loop_bounds_handle_calls_brackets_and_quoted_to(self):
        for bounds in ('min(1, len("x to y")) to max(2, 3)',
                       'values["from to until"] to len([" to ", "total"])',
                       'first to total', '-2 to 0', '3 to 1'):
            with self.subTest(bounds=bounds):
                self.assert_clean(routine(f"for i = {bounds}:\n    > Process i."))

    def test_counted_loop_bounds_use_expression_whitelist(self):
        for bounds in ('unknown_api() to 3', '(lambda: 1)() to 3',
                       '[i for i in range(3)] to 4', 'data.__class__ to 2',
                       '(yield 1) to 2', '1, unknown_api() to 2'):
            with self.subTest(bounds=bounds):
                self.assertTrue(self.errors(routine(f"for i = {bounds}:\n    return None")))

    def test_counted_loop_requires_one_real_separator_and_each_bound(self):
        for bounds in ('to 3', '1 to', '1 to 2 to 3', 'total', 'len("to")',
                       '1 too 3', '"to"', '1 to 2 step 1'):
            with self.subTest(bounds=bounds):
                self.assertTrue(self.errors(routine(f"for i = {bounds}:\n    return None")))

    def test_counted_loop_bounds_can_forward_call_declared_function(self):
        self.assert_clean(document('''fn use() -> None:
    covers R1
    for i = bound() to bound():
        > Process i.
fn bound() -> Int:
    covers R1
    return 1'''))

    def test_root_native_unit_can_supply_canonical_behavior_and_coverage(self):
        self.assert_clean(document("covers R1", 'native "rust":\n    pub fn run() {}'), ready=True)

    def test_top_covers_requires_root_behavior_unit_and_real_requirement(self):
        self.assert_error(routine("return None", extra="covers R1"), "top-level covers requires a top-level")
        self.assert_error(document("covers Missing", "native lua:\n    print(1)"), "unknown requirement 'Missing'")
        self.assert_error(document("covers R1", "covers R1", "native lua:\n    print(1)"), "duplicate top-level covers")

    def test_root_support_native_needs_no_extra_coverage(self):
        self.assert_clean(routine("return None", extra='native c:\n    typedef int Value;'))

    def test_draft_root_unit_can_omit_coverage_but_ready_cannot(self):
        self.assert_clean(document("native lua:\n    print(1)", state="draft"))
        self.assert_error(document("native lua:\n    print(1)"), "uncovered requirement")

    def test_alias_declarations_alone_are_not_executable_units(self):
        self.assert_error(document("alias Run -> Run body"), "at least one fn declaration")

    def test_opaque_surfaces_produce_semantic_advisories(self):
        source = document("covers R1", "alias Run -> Run body", "Run:\n    native lua:\n        print(1)")
        warnings = [d.message for d in checker.check_text(source) if d.severity == "warning"]
        self.assertTrue(any("scheduling" in warning for warning in warnings))
        self.assertTrue(any("target syntax" in warning for warning in warnings))

    def test_unknown_hard_syntax_is_not_accepted_as_extensibility(self):
        for body in ('fro i = 1 to 3:\n    return None', 'with resource:\n    return None',
                     'result += 1', 'result = eval("1")', 'return f"{name}"', 'pass', '...'):
            with self.subTest(body=body):
                self.assertTrue(self.errors(routine(body)))

    def test_inert_syntax_cannot_steal_unrelated_statement_validation(self):
        for body in ("Run:\n    pass", 'native lua:\n    anything\nunknown_api()',
                     "for i = 1 to 2:\n    pass", "> Group:\n    unknown_api()"):
            with self.subTest(body=body):
                self.assertTrue(self.errors(routine(body, extra="alias Run -> Use body")))

    def test_checker_never_executes_payload_or_opens_refs(self):
        with tempfile.TemporaryDirectory(prefix="plainlogic-checker-") as directory:
            sentinel = Path(directory) / "must-not-exist.txt"
            payload = f'__import__("pathlib").Path({str(sentinel)!r}).write_text("bad")'
            self.assert_clean(document("covers R1", f'ref data "{sentinel.as_posix()}"',
                                       "alias Run -> " + payload, "Run:\n    native python:\n        " + payload))
            self.assertFalse(sentinel.exists())
            self.assertTrue(self.errors(routine(f"for i = {payload} to 3:\n    return None")))
            self.assertFalse(sentinel.exists())

    def test_cli_reads_utf8_bom_prints_advisories_and_sets_exit_code(self):
        with tempfile.TemporaryDirectory(prefix="plainlogic-checker-") as directory:
            path = Path(directory) / "source.plog"
            path.write_text(document("covers R1", "native lua:\n    print(1)"), encoding="utf-8-sig")
            environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
            result = subprocess.run([sys.executable, "-B", str(CHECKER), str(path), "--ready"],
                                    text=True, capture_output=True, env=environment, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("0 error(s)", result.stdout)
            self.assertIn("No code executed", result.stdout)
            path.write_text(routine("unknown_api()"), encoding="utf-8")
            result = subprocess.run([sys.executable, "-B", str(CHECKER), str(path)],
                                    text=True, capture_output=True, env=environment, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertIn("call 'unknown_api'", result.stdout)

    # --- Regression tests for the 2026-10-20 review fix pass ---

    def test_deeply_nested_expression_reports_instead_of_crashing(self):
        errors = self.errors(routine("return " + "not " * 1500 + "True"))
        self.assertTrue(any("too deeply nested" in error for error in errors), errors)

    def test_deep_but_plausible_nesting_is_accepted(self):
        self.assert_clean(routine("return " + "not " * 800 + "True"))
        self.assert_clean(routine("""
            total = 0
            for a in range(1, 3):
                for b in range(1, 3):
                    for c in range(1, 3):
                        while total < 1:
                            total = total + 1
                            break
            return None
        """))

    def test_counted_loop_bound_may_use_an_attribute_named_to(self):
        for header in ("for i = config.to to 5:", "for i = 1 to config.to:"):
            with self.subTest(header=header):
                source = document(
                    "fn run(config: Config) -> Int:\n    covers R1\n    total = 0\n"
                    f"    {header}\n        total = total + i\n    return total",
                    state="draft")
                self.assertFalse(any("counted loop" in error for error in self.errors(source)),
                                 self.errors(source))

    def test_tabs_are_rejected_only_in_indentation(self):
        self.assert_clean(routine('msg = "a\tb"  # comment\twith tab\n> Step\tone\nreturn None'))
        source = routine("return None").replace("\n    return None", "\n\treturn None")
        self.assert_error(source, "tabs are unsupported in indentation")

    def test_a_lex_error_does_not_suppress_other_checks(self):
        source = routine("a = 1; b = 2\n    return None", extra='require R2 "Second requirement."')
        errors = self.errors(source, ready=True)
        self.assertTrue(any("semicolon-separated" in error for error in errors), errors)
        self.assertTrue(any("uncovered requirement" in error for error in errors), errors)

    def test_bare_container_types_need_their_arguments(self):
        for spelling in ("List", "Map", "Set", "List[List]"):
            with self.subTest(spelling=spelling):
                source = document(f"fn run(value: {spelling}) -> None:\n    covers R1\n    return None")
                self.assert_error(source, "needs its type arguments")
        self.assert_clean(document("fn run(value: List[Int]) -> None:\n    covers R1\n    return None"))

    def test_case_entries_are_validated(self):
        self.assert_clean(document(
            "fn run() -> Int:\n    covers R1\n    return 1",
            "case sample:\n    given value = 1\n    expect run() == value"))
        self.assert_error(document(
            "fn run() -> Int:\n    covers R1\n    return 1",
            "case sample:\n    frobnicate value"), "case entries must be given")
        self.assert_error(document(
            "fn run() -> Int:\n    covers R1\n    return 1",
            "case sample:\n    given value = 1\n    given value = 2"), "duplicate given name")
        self.assert_error(document(
            "fn run() -> Int:\n    covers R1\n    return 1",
            "case sample:\n    stub missing(1) returns 1"), "stub must describe a declared port call")

    def test_port_entries_are_validated(self):
        def with_port(*entries: str) -> str:
            return document('ref source "src/source.py#load"',
                            "port load(id: Int) -> Int:\n" + "\n".join(f"    {entry}" for entry in entries),
                            "fn run() -> None:\n    covers R1\n    return None")
        self.assert_clean(with_port("effect read", 'contract "Load it."', "bind source"))
        self.assert_error(with_port("effect pure, read", 'contract "Load it."'), "pure cannot be combined")
        self.assert_error(with_port("effect read, read", 'contract "Load it."'), "duplicate effect category")
        self.assert_error(with_port("effect bogus", 'contract "Load it."'), "effect categories are")
        self.assert_error(with_port("effect read"), "port requires exactly one contract")
        self.assert_error(with_port('contract "Load it."'), "port requires exactly one effect")
        self.assert_error(with_port("effect read", 'contract "Load it."', "bind nowhere"),
                          "bind must name a declared ref")

    def test_record_fields_are_validated(self):
        self.assert_error(document(
            "record Value:\n    amount: Int\n    amount: Int",
            "fn run() -> None:\n    covers R1\n    return None"), "duplicate record field")
        self.assert_error(document(
            "record Value:\n    class: Int",
            "fn run() -> None:\n    covers R1\n    return None"), "record field 'class' is a keyword")

    def test_statement_forms_smoke(self):
        source = document(
            "record Failure:\n    message: Text",
            "port fetch(id: Int) -> Int:\n    effect read\n    contract \"Fetch one value.\"",
            """async fn run(flag: Bool, values: List[Int]) -> Int:
    covers R1
    total = 0
    while total < 3:
        total = total + 1
    if flag:
        total = total + 10
    elif total > 100:
        total = 0
    else:
        total = total + 1
    picked = total if flag else 0
    values.append(picked)
    try:
        result = await fetch(picked)
    except Failure as problem:
        raise Failure(message="failed")
    finally:
        total = total
    return result""",
            state="draft")
        self.assertEqual(self.errors(source), [])


    def test_shipped_examples_match_their_documented_class(self):
        examples = Path(__file__).resolve().parents[1] / "examples"
        for name in ("quote-total.plog", "mixed-total.plog", "coroutine-canonical.plog", "native-target.plog"):
            with self.subTest(example=name):
                self.assertEqual(self.errors((examples / name).read_text(encoding="utf-8"), ready=True), [])
        draft = (examples / "execute-request-draft.plog").read_text(encoding="utf-8")
        self.assertEqual(self.errors(draft), [])
        self.assertTrue(self.errors(draft, ready=True))
        for name in ("aliases.plog", "execute-request.plog"):
            with self.subTest(example=name):
                errors = self.errors((examples / name).read_text(encoding="utf-8"))
                self.assertTrue(any("prose steps require" in error for error in errors), errors)

if __name__ == "__main__":
    unittest.main()
