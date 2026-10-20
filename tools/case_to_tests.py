#!/usr/bin/env python3
"""Generate target-language unit tests from a PlainLogic document's cases.

Each `case` becomes one test: `given` entries become setup assignments,
`stub port(...) returns expr` entries become port doubles (Python output),
and `expect` entries become assertions. Expressions are rendered from the
parsed PlainLogic AST; anything outside the renderable subset turns the
affected test into an explicit skip rather than a wrong test. No document
code is executed.
"""

from __future__ import annotations

import argparse
import ast
import io
import json
import re
import sys
import tokenize
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_plainlogic as checker_module  # noqa: E402


class RenderError(Exception):
    """An expression uses a form the renderer does not support."""


def camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:] if part)


class Renderer:
    def __init__(self, target: str, records: set[str]) -> None:
        self.target = target
        self.records = records
        self.uses_floor_mod = False

    def name(self, ident: str) -> str:
        return camel(ident) if self.target == "typescript" else ident

    def render(self, node: ast.AST) -> str:
        method = getattr(self, f"visit_{type(node).__name__}", None)
        if method is None:
            raise RenderError(f"unsupported expression form: {type(node).__name__}")
        return method(node)

    def visit_Constant(self, node: ast.Constant) -> str:
        if node.value is None:
            return "null" if self.target == "typescript" else "None"
        if node.value is True or node.value is False:
            if self.target == "typescript":
                return "true" if node.value else "false"
            return "True" if node.value else "False"
        if isinstance(node.value, str):
            return json.dumps(node.value)
        if isinstance(node.value, (int, float)):
            return repr(node.value)
        raise RenderError(f"unsupported constant: {node.value!r}")

    def visit_Name(self, node: ast.Name) -> str:
        return self.name(node.id)

    def visit_List(self, node: ast.List) -> str:
        return "[" + ", ".join(self.render(elt) for elt in node.elts) + "]"

    def visit_Tuple(self, node: ast.Tuple) -> str:
        items = ", ".join(self.render(elt) for elt in node.elts)
        if self.target == "typescript":
            return f"[{items}]"
        return f"({items},)" if len(node.elts) == 1 else f"({items})"

    def visit_Set(self, node: ast.Set) -> str:
        items = ", ".join(self.render(elt) for elt in node.elts)
        return f"new Set([{items}])" if self.target == "typescript" else "{" + items + "}"

    def visit_Dict(self, node: ast.Dict) -> str:
        pairs = []
        for key, value in zip(node.keys, node.values):
            if key is None:
                raise RenderError("dict unpacking is unsupported")
            rendered_key = self.render(key)
            if self.target == "typescript" and isinstance(key, ast.Constant) and isinstance(key.value, str) \
                    and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.value):
                rendered_key = camel(key.value)
            separator = ": " if self.target == "typescript" else ": "
            pairs.append(f"{rendered_key}{separator}{self.render(value)}")
        return "{" + ", ".join(pairs) + "}"

    _BINOPS = {ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/",
               ast.FloorDiv: "//", ast.Mod: "%", ast.Pow: "**"}

    def visit_BinOp(self, node: ast.BinOp) -> str:
        op = self._BINOPS.get(type(node.op))
        if op is None:
            raise RenderError(f"unsupported operator: {type(node.op).__name__}")
        left, right = self.render(node.left), self.render(node.right)
        if self.target == "typescript":
            if isinstance(node.op, ast.FloorDiv):
                return f"Math.floor({left} / {right})"
            if isinstance(node.op, ast.Mod):
                self.uses_floor_mod = True
                return f"__floorMod({left}, {right})"
        return f"({left} {op} {right})"

    def visit_UnaryOp(self, node: ast.UnaryOp) -> str:
        operand = self.render(node.operand)
        if isinstance(node.op, ast.Not):
            return f"(!{operand})" if self.target == "typescript" else f"(not {operand})"
        if isinstance(node.op, ast.USub):
            return f"(-{operand})"
        if isinstance(node.op, ast.UAdd):
            return f"(+{operand})"
        raise RenderError(f"unsupported unary operator: {type(node.op).__name__}")

    def visit_BoolOp(self, node: ast.BoolOp) -> str:
        joiner = " && " if isinstance(node.op, ast.And) else " || "
        if self.target == "python":
            joiner = " and " if isinstance(node.op, ast.And) else " or "
        return "(" + joiner.join(self.render(value) for value in node.values) + ")"

    _COMPARE = {ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=",
                ast.Gt: ">", ast.GtE: ">=", ast.In: "in", ast.NotIn: "not in"}

    def visit_Compare(self, node: ast.Compare) -> str:
        parts = [self.render(node.left)]
        for op, comparator in zip(node.ops, node.comparators):
            symbol = self._COMPARE.get(type(op))
            if symbol is None or (self.target == "typescript" and symbol in ("in", "not in")):
                raise RenderError(f"unsupported comparison: {type(op).__name__}")
            parts.append(symbol)
            parts.append(self.render(comparator))
        return "(" + " ".join(parts) + ")"

    def visit_IfExp(self, node: ast.IfExp) -> str:
        if self.target == "typescript":
            return f"({self.render(node.test)} ? {self.render(node.body)} : {self.render(node.orelse)})"
        return f"({self.render(node.body)} if {self.render(node.test)} else {self.render(node.orelse)})"

    def visit_Attribute(self, node: ast.Attribute) -> str:
        return f"{self.render(node.value)}.{self.name(node.attr)}"

    def visit_Subscript(self, node: ast.Subscript) -> str:
        return f"{self.render(node.value)}[{self.render(node.slice)}]"

    def visit_Call(self, node: ast.Call) -> str:
        if not isinstance(node.func, ast.Name):
            raise RenderError("only calls to declared routines, records, and ports are supported")
        func = node.func.id
        if func in self.records:
            if node.args:
                raise RenderError("record construction in cases uses named fields")
            fields = []
            for keyword in node.keywords:
                if keyword.arg is None:
                    raise RenderError("record construction does not support ** unpacking")
                key = camel(keyword.arg) if self.target == "typescript" else keyword.arg
                fields.append(f"{key}: {self.render(keyword.value)}" if self.target == "typescript"
                              else f"{key}={self.render(keyword.value)}")
            if self.target == "typescript":
                return "{" + ", ".join(fields) + "}"
            return f"{func}({', '.join(fields)})"
        args = [self.render(arg) for arg in node.args]
        for keyword in node.keywords:
            if keyword.arg is None:
                raise RenderError("** call arguments are unsupported")
            args.append(f"{self.name(keyword.arg)}={self.render(keyword.value)}" if self.target == "python"
                        else f"{self.render(keyword.value)}")
        return f"{self.name(func)}({', '.join(args)})"


def _parse(source: str) -> ast.Expression:
    return ast.parse(source, mode="eval")


def _stub_split(source: str) -> tuple[str, str] | None:
    depth = 0
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type == tokenize.OP:
                if token.string in "([{":
                    depth += 1
                elif token.string in ")]}":
                    depth -= 1
            if depth == 0 and token.type == tokenize.NAME and token.string == "returns":
                return source[:token.start[1]].strip(), source[token.start[1] + len("returns"):].strip()
    except (tokenize.TokenError, IndentationError):
        return None
    return None


class CaseData:
    def __init__(self, name: str) -> None:
        self.name = name
        self.givens: list[tuple[str, str]] = []
        self.stubs: list[tuple[str, str, str]] = []
        self.expects: list[str] = []


def collect_cases(checker: "checker_module.Checker") -> list[CaseData]:
    cases: list[CaseData] = []
    for declaration in checker.declarations.values():
        if declaration.kind != "case":
            continue
        case = CaseData(declaration.name)
        for line in declaration.body:
            match = re.fullmatch(rf"given\s+({checker_module.IDENT})\s*=\s*(.+)", line.text)
            if match:
                case.givens.append((match.group(1), match.group(2)))
                continue
            if line.text.startswith("stub "):
                split = _stub_split(line.text[5:])
                if split is not None:
                    call = _parse(split[0]).body
                    if isinstance(call, ast.Call) and isinstance(call.func, ast.Name):
                        case.stubs.append((call.func.id, split[0], split[1]))
                continue
            match = re.fullmatch(r"expect\s+(.+)", line.text)
            if match:
                case.expects.append(match.group(1))
        cases.append(case)
    return cases


def generate(source: str, target: str, module: str, origin: str) -> str:
    checker = checker_module.Checker(source)
    diagnostics = checker.run()
    errors = [d for d in diagnostics if d.severity == "error"]
    if errors:
        summary = "; ".join(f"line {d.line}: {d.message}" for d in errors[:5])
        raise ValueError(f"document has checker errors: {summary}")
    records = {name for name, d in checker.declarations.items() if d.kind == "record"}
    routines = [name for name, d in checker.declarations.items() if d.kind == "fn"]
    cases = collect_cases(checker)
    if target == "python":
        return _generate_python(cases, records, routines, module, origin)
    return _generate_typescript(cases, records, routines, module, origin)


def _assertion(renderer: Renderer, source: str, target: str) -> str:
    node = _parse(source).body
    if target == "python":
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
            return f"assert {renderer.render(node.left)} == {renderer.render(node.comparators[0])}"
        return f"assert {renderer.render(node)}"
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
        return f"expect({renderer.render(node.left)}).toEqual({renderer.render(node.comparators[0])});"
    return f"expect({renderer.render(node)}).toBe(true);"


def _generate_python(cases: list[CaseData], records: set[str], routines: list[str],
                     module: str, origin: str) -> str:
    out = [f"# Generated from the cases in {origin} by tools/case_to_tests.py.",
           "# Regenerate instead of editing by hand.", ""]
    imported = sorted(set(routines) | records)
    out.append("import pytest")
    if imported:
        out.append(f"from {module} import {', '.join(imported)}")
    out.append("")
    for case in cases:
        renderer = Renderer("python", records)
        params = "monkeypatch" if case.stubs else ""
        body: list[str] = []
        try:
            for name, expr in case.givens:
                body.append(f"{name} = {renderer.render(_parse(expr).body)}")
            for port, _call, result in case.stubs:
                body.append(f'monkeypatch.setattr("{module}.{port}", '
                            f'lambda *args, **kwargs: {renderer.render(_parse(result).body)})')
            for expect in case.expects:
                body.append(_assertion(renderer, expect, "python"))
            if not body:
                body.append('pytest.skip("case has no renderable entries")')
        except RenderError as exc:
            body = [f'pytest.skip("case not generated: {exc}")']
        out.append("")
        out.append(f"def test_case_{case.name}({params}):")
        out.extend(f"    {line}" for line in body)
    return "\n".join(out).rstrip() + "\n"


def _generate_typescript(cases: list[CaseData], records: set[str], routines: list[str],
                         module: str, origin: str) -> str:
    out = [f"// Generated from the cases in {origin} by tools/case_to_tests.py.",
           "// Regenerate instead of editing by hand.", "",
           'import { describe, expect, it } from "vitest";']
    imported = sorted(camel(name) for name in routines)
    if imported:
        out.append(f'import {{ {", ".join(imported)} }} from "{module}";')
    needs_helper = False
    blocks: list[str] = []
    for case in cases:
        renderer = Renderer("typescript", records)
        if case.stubs:
            blocks.append(f'  it.skip("case {case.name}: stub cases need manual mock wiring", () => {{}});')
            continue
        body: list[str] = []
        try:
            for name, expr in case.givens:
                body.append(f"const {camel(name)} = {renderer.render(_parse(expr).body)};")
            for expect in case.expects:
                body.append(_assertion(renderer, expect, "typescript"))
            if not body:
                body.append('throw new Error("case has no renderable entries");')
        except RenderError as exc:
            blocks.append(f'  it.skip("case {case.name}: not generated: {exc}", () => {{}});')
            continue
        needs_helper = needs_helper or renderer.uses_floor_mod
        blocks.append(f'  it("case {case.name}", () => {{')
        blocks.extend(f"    {line}" for line in body)
        blocks.append("  });")
    if needs_helper:
        out.append("const __floorMod = (a: number, b: number) => ((a % b) + b) % b;")
    out.append("")
    out.append('describe("PlainLogic cases", () => {')
    out.extend(blocks)
    out.append("});")
    return "\n".join(out).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="UTF-8 .plog document whose cases to convert")
    parser.add_argument("--target", choices=("python", "typescript"), required=True)
    parser.add_argument("--module", help="module to import the implementation from (default: the document's file stem)")
    parser.add_argument("--out", type=Path, help="write here instead of stdout")
    arguments = parser.parse_args(argv)
    try:
        source = arguments.file.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        print(f"{arguments.file}: error: cannot read UTF-8 document: {exc}", file=sys.stderr)
        return 1
    module = arguments.module or arguments.file.stem.replace("-", "_")
    try:
        generated = generate(source, arguments.target, module, arguments.file.name)
    except ValueError as exc:
        print(f"{arguments.file}: error: {exc}", file=sys.stderr)
        return 1
    if arguments.out:
        arguments.out.write_text(generated, encoding="utf-8")
    else:
        sys.stdout.write(generated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
