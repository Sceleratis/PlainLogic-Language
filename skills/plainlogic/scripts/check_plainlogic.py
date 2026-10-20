#!/usr/bin/env python3
"""Check PlainLogic 0.1–0.3 structure without running it or opening its references."""

from __future__ import annotations

import argparse
import ast
from dataclasses import dataclass, field
import io
import keyword
from pathlib import Path
import re
import sys
import tokenize


IDENT = r"[A-Za-z_][A-Za-z0-9_]*"
TYPES = {"Text", "Int", "Decimal", "Bool", "None", "List", "Map", "Set"}
PRIMITIVES = {"len", "min", "max", "sum", "abs", "sorted", "range", "Decimal"}
RESERVED = set(keyword.kwlist) | TYPES | PRIMITIVES | {
    "plainlogic", "unit", "state", "draft", "ready", "intent", "scope", "require",
    "ref", "open", "type", "record", "port", "fn", "case", "covers", "effect",
    "contract", "bind", "given", "stub", "returns", "expect", "ask",
}
EXTENSION_RESERVED = {"alias", "native", "target", "to"}


@dataclass
class Diagnostic:
    line: int
    message: str
    severity: str = "error"


@dataclass
class Line:
    number: int
    indent: int
    text: str


@dataclass
class Declaration:
    kind: str
    name: str
    line: Line
    body: list[Line] = field(default_factory=list)
    parameters: list[str] = field(default_factory=list)
    asynchronous: bool = False


class Checker:
    def __init__(self, source: str, ready: bool = False):
        self.source = source
        self.require_ready = ready
        self.diagnostics: list[Diagnostic] = []
        self.lines: list[Line] = []
        self.line_text: dict[int, str] = {}
        self.declarations: dict[str, Declaration] = {}
        self.blocks: list[Declaration] = []
        self.requirements: set[str] = set()
        self.references: set[str] = set()
        self.questions: set[str] = set()
        self.covered: set[str] = set()
        self.state = ""
        self.version = ""
        self.prose_lines: dict[int, bool] = {}
        self.native_blocks: dict[int, list[int]] = {}
        self.alias_invocations: dict[int, str] = {}
        self.duplicate_names: set[str] = set()
        self.root_covers: list[Line] = []

    def error(self, line: int, message: str) -> None:
        self.diagnostics.append(Diagnostic(line, message))

    def parse_expression(self, source: str, line: int) -> ast.expr | None:
        try:
            return ast.parse(source, mode="eval").body
        except (SyntaxError, ValueError, RecursionError) as exc:
            detail = exc.msg if isinstance(exc, SyntaxError) else "expression is too complex"
            self.error(line, f"invalid expression: {detail}")
            return None

    def quoted(self, source: str, line: int) -> str | None:
        value = self.parse_expression(source, line)
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            if not value.value.strip():
                self.error(line, "a nonempty quoted string is required")
            return value.value
        if value is not None:
            self.error(line, "a single quoted string is required")
        return None

    def lex(self) -> None:
        # Tokenization strips comments without treating '#' or ';' inside strings as syntax.
        native_header: Line | None = None
        for number, raw in enumerate(self.source.splitlines(), 1):
            indent = len(raw) - len(raw.lstrip(" "))
            text = raw.strip()
            if not self.lines:
                version = re.fullmatch(r"plainlogic (0\.[123])(?:\s*#.*)?", text)
                if version:
                    self.version = version.group(1)
            if native_header is not None:
                if not text:
                    continue
                if indent > native_header.indent:
                    if not raw.startswith(" " * (native_header.indent + 4)):
                        self.error(number, "native content requires a four-space container margin beyond its header")
                    self.native_blocks[native_header.number].append(number)
                    continue
                # A tab cannot replace the container's spaces, even at its first column.
                if raw.startswith(" " * native_header.indent + "\t"):
                    self.error(number, "native content requires a four-space container margin beyond its header")
                    self.native_blocks[native_header.number].append(number)
                    continue
                if not self.native_blocks[native_header.number]:
                    self.error(native_header.number, "native needs a nonempty literal body")
                native_header = None
            if "\t" in raw:
                self.error(number, "tabs are unsupported; indent with four spaces")
            # Alias descriptions and native content are data, never Python tokens.
            if re.match(rf"alias\s+{IDENT}\s*->", text):
                if indent % 4:
                    self.error(number, "indentation must be a multiple of four spaces")
                self.lines.append(Line(number, indent, text))
                self.line_text[number] = text
                continue
            native_candidate = re.fullmatch(rf"native\s+(?:{IDENT}|\".*\"|'.*')\s*:", text)
            if re.match(r"native\b", text) and (self.version == "0.3" or native_candidate):
                if indent % 4:
                    self.error(number, "indentation must be a multiple of four spaces")
                line = Line(number, indent, text)
                self.lines.append(line)
                self.line_text[number] = text
                match = re.fullmatch(r"native\s+(.+):", text)
                label = match.group(1).strip() if match else ""
                valid = bool(re.fullmatch(IDENT, label))
                if label.startswith(("'", '"')):
                    before = len(self.diagnostics)
                    value = self.quoted(label, number)
                    valid = value is not None and bool(value.strip()) and len(self.diagnostics) == before
                if not valid:
                    self.error(number, 'native header must be native "language": or native language:')
                else:
                    self.native_blocks[number] = []
                    native_header = line
                continue
            # Prose is opaque text. Never send its punctuation, quotes, or Unicode
            # through Python's tokenizer; only its prefix and final colon matter here.
            text = raw.strip()
            if text.startswith(">"):
                if indent % 4:
                    self.error(number, "indentation must be a multiple of four spaces")
                block = text.endswith(":")
                content = text[1:-1] if block else text[1:]
                if not content.strip():
                    self.error(number, "a prose step requires nonempty text after '>'")
                self.prose_lines[number] = block
                self.lines.append(Line(number, indent, text))
                self.line_text[number] = text
                continue
            try:
                tokens = list(tokenize.generate_tokens(io.StringIO(raw + "\n").readline))
            except (tokenize.TokenError, IndentationError, SyntaxError):
                self.error(number, "unfinished token or multiline statement; use one physical line")
                continue
            end = len(raw)
            for token in tokens:
                if token.type == tokenize.COMMENT:
                    end = token.start[1]
                    break
                if token.type == tokenize.NAME and not re.fullmatch(IDENT, token.string):
                    self.error(number, "names must be ASCII identifiers")
                if token.type == tokenize.OP and token.string == ";":
                    self.error(number, "semicolon-separated statements are unsupported")
                if token.type == tokenize.ERRORTOKEN and not token.string.isspace():
                    self.error(number, "invalid token or unsupported line continuation")
                if token.type == tokenize.STRING:
                    spelling = re.sub(r"^[A-Za-z]+", "", token.string)
                    if spelling.startswith(('"""', "'''")):
                        self.error(number, "triple-quoted and multiline strings are unsupported")
                if token.type in {getattr(tokenize, "FSTRING_START", -1),
                                  getattr(tokenize, "TSTRING_START", -2)}:
                    self.error(number, "interpolated strings are unsupported")
            text = raw[:end].strip()
            if text:
                if indent % 4:
                    self.error(number, "indentation must be a multiple of four spaces")
                self.lines.append(Line(number, indent, text))
                self.line_text[number] = text
        if native_header is not None and not self.native_blocks[native_header.number]:
            self.error(native_header.number, "native needs a nonempty literal body")

    def register(self, declaration: Declaration) -> None:
        name = declaration.name
        if name in RESERVED or (self.version == "0.3" and name in EXTENSION_RESERVED):
            self.error(declaration.line.number, f"reserved name '{name}' cannot be declared")
        previous = self.declarations.get(name)
        if previous:
            self.duplicate_names.add(name)
            self.error(declaration.line.number,
                       f"duplicate name '{name}' (first declared on line {previous.line.number})")
        else:
            self.declarations[name] = declaration

    def check_type(self, node: ast.expr, line: int) -> None:
        if isinstance(node, ast.Name) and re.fullmatch(IDENT, node.id):
            return
        if isinstance(node, ast.Constant) and node.value is None:
            return
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            self.check_type(node.left, line)
            self.check_type(node.right, line)
            return
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
            arity = {"List": 1, "Map": 2, "Set": 1}.get(node.value.id)
            arguments = list(node.slice.elts) if isinstance(node.slice, ast.Tuple) else [node.slice]
            symbolic = (self.version == "0.3" and re.fullmatch(IDENT, node.value.id)
                        and node.value.id not in TYPES and bool(arguments))
            if (arity is not None and len(arguments) == arity) or symbolic:
                for argument in arguments:
                    self.check_type(argument, line)
                return
        self.error(line, "unsupported type; use a named type, None, List[T], Map[K, V], Set[T], union, or 0.3 symbolic Name[T]")

    def type_source(self, source: str, line: int) -> None:
        expression = self.parse_expression(source, line)
        if expression is not None:
            self.check_type(expression, line)

    @staticmethod
    def python_header(declaration: Declaration) -> str:
        return re.sub(r"\b(?:fn|port)\b", "def", declaration.line.text, count=1)

    def signature(self, declaration: Declaration) -> None:
        try:
            routine = ast.parse(self.python_header(declaration) + "\n    pass\n").body[0]
        except (SyntaxError, ValueError, RecursionError) as exc:
            detail = exc.msg if isinstance(exc, SyntaxError) else "signature is too complex"
            self.error(declaration.line.number, f"invalid routine signature: {detail}")
            return
        if not isinstance(routine, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.error(declaration.line.number, "invalid routine signature")
            return
        args = routine.args
        if args.posonlyargs or args.kwonlyargs or args.vararg or args.kwarg or args.defaults:
            self.error(declaration.line.number, "parameters must be typed names; defaults, /, *, and ** are unsupported")
        seen: set[str] = set()
        for argument in args.posonlyargs + args.args + args.kwonlyargs:
            if argument.arg in seen:
                self.error(declaration.line.number, f"duplicate parameter '{argument.arg}'")
            seen.add(argument.arg)
            if not re.fullmatch(IDENT, argument.arg):
                self.error(declaration.line.number, "parameter names must be ASCII identifiers")
            if argument.annotation is None:
                self.error(declaration.line.number, f"parameter '{argument.arg}' needs a type")
            else:
                self.check_type(argument.annotation, declaration.line.number)
        declaration.parameters = [argument.arg for argument in args.args]
        if routine.returns is None:
            self.error(declaration.line.number, "a return type is required")
        else:
            self.check_type(routine.returns, declaration.line.number)
        if getattr(routine, "type_params", []):
            self.error(declaration.line.number, "generic routine parameters are unsupported")

    def collect(self) -> None:
        expected = [r"plainlogic (0\.[123])", rf"unit ({IDENT})", r"state (draft|ready)"]
        if len(self.lines) < 3:
            self.error(1, "the first three meaningful lines must be plainlogic 0.1|0.2|0.3, unit <Name>, state draft|ready")
            return
        for index, pattern in enumerate(expected):
            line = self.lines[index]
            match = re.fullmatch(pattern, line.text)
            if line.indent or not match:
                self.error(line.number, f"invalid header line {index + 1}")
            elif index == 0:
                self.version = match.group(1)
            elif index == 1:
                self.register(Declaration("unit", match.group(1), line))
            elif index == 2:
                self.state = match.group(1)
        metadata: dict[str, int] = {}
        index = 3
        while index < len(self.lines):
            line = self.lines[index]
            if line.indent:
                self.error(line.number, "unexpected indentation outside a declaration")
                index += 1
                continue
            end = index + 1
            while end < len(self.lines) and self.lines[end].indent:
                end += 1
            body = self.lines[index + 1:end]
            text = line.text
            match = re.fullmatch(r"(intent|scope|target)\s+(.+)", text)
            if match:
                kind, value = match.groups()
                if kind in metadata:
                    self.error(line.number, f"duplicate {kind} declaration")
                metadata[kind] = line.number
                if kind == "target" and self.version != "0.3":
                    self.error(line.number, "target metadata requires plainlogic 0.3")
                self.quoted(value, line.number)
                if body:
                    self.error(body[0].number, f"{kind} cannot have an indented body")
                index = end
                continue
            match = re.fullmatch(rf"alias\s+({IDENT})\s*->\s*(.*)", text)
            if match:
                name, description = match.groups()
                if self.version != "0.3":
                    self.error(line.number, "behavior aliases require plainlogic 0.3")
                if not description.strip():
                    self.error(line.number, "alias requires nonempty descriptive text after '->'")
                self.register(Declaration("alias", name, line))
                if body:
                    self.error(body[0].number, "alias declarations cannot have an indented body; invoke the alias separately")
                index = end
                continue
            match = re.fullmatch(r"covers\s+(.+)", text)
            if match:
                if self.version != "0.3":
                    self.error(line.number, "top-level covers requires plainlogic 0.3")
                if self.root_covers:
                    self.error(line.number, "duplicate top-level covers declaration")
                self.root_covers.append(line)
                if body:
                    self.error(body[0].number, "covers cannot have an indented body")
                index = end
                continue
            if line.number in self.native_blocks:
                self.blocks.append(Declaration("native", "", line))
                if body:
                    self.error(body[0].number, "unexpected indentation after native block")
                index = end
                continue
            match = re.fullmatch(rf"({IDENT})\s*:", text)
            if match and match.group(1) not in RESERVED:
                name = match.group(1)
                self.alias_invocations[line.number] = name
                self.blocks.append(Declaration("alias-unit", name, line, body))
                if not body:
                    self.error(line.number, "alias invocation needs an indented body")
                index = end
                continue
            match = re.fullmatch(rf"(require|ref|open)\s+({IDENT})\s+(.+)", text)
            if match:
                kind, name, value = match.groups()
                declaration = Declaration(kind, name, line)
                self.register(declaration)
                self.quoted(value, line.number)
                {"require": self.requirements, "ref": self.references, "open": self.questions}[kind].add(name)
                if body:
                    self.error(body[0].number, f"{kind} cannot have an indented body")
                index = end
                continue
            match = re.fullmatch(rf"type\s+({IDENT})\s*=\s*(.+)", text)
            if match:
                name, source = match.groups()
                self.register(Declaration("type", name, line))
                self.type_source(source, line.number)
                if body:
                    self.error(body[0].number, "type aliases cannot have an indented body")
                index = end
                continue
            match = re.fullmatch(rf"(record|case)\s+({IDENT})\s*:", text)
            if match:
                kind, name = match.groups()
                declaration = Declaration(kind, name, line, body)
            else:
                match = re.fullmatch(rf"(async\s+)?(fn|port)\s+({IDENT})\s*\(.*\)\s*(?:->\s*.+)?\s*:", text)
                if match:
                    async_prefix, kind, name = match.groups()
                    declaration = Declaration(kind, name, line, body, asynchronous=bool(async_prefix))
                    self.signature(declaration)
                else:
                    self.error(line.number, "unsupported or malformed top-level declaration")
                    index = end
                    continue
            self.register(declaration)
            self.blocks.append(declaration)
            if not body:
                self.error(line.number, f"{declaration.kind} needs an indented body")
            index = end
        for kind in ("intent", "scope"):
            if kind not in metadata:
                self.error(1, f"one {kind} string is required")
        if not self.requirements:
            self.error(1, "at least one require declaration is required")
        root_units = any(block.kind in {"alias-unit", "native"} for block in self.blocks)
        if not any(block.kind == "fn" for block in self.blocks) and not (self.version == "0.3" and root_units):
            self.error(1, "at least one fn declaration or 0.3 top-level alias/native unit is required")
        for line in self.root_covers:
            if not root_units:
                self.error(line.number, "top-level covers requires a top-level alias invocation or native block")
            self.coverage(line)

    def coverage(self, line: Line) -> None:
        source = re.sub(r"^covers\s+", "", line.text)
        for requirement in (part.strip() for part in source.split(",")):
            if requirement not in self.requirements:
                self.error(line.number, f"covers must name a declared require; unknown requirement '{requirement}'")
            else:
                self.covered.add(requirement)

    def flat(self, line: Line, declaration: Declaration) -> bool:
        if line.indent != 4:
            self.error(line.number, f"{declaration.kind} entries must be indented exactly four spaces")
            return False
        return True

    def record(self, declaration: Declaration) -> None:
        fields: set[str] = set()
        for line in declaration.body:
            if not self.flat(line, declaration):
                continue
            match = re.fullmatch(rf"({IDENT})\s*:\s*(.+)", line.text)
            if not match:
                self.error(line.number, "record entries must be field: Type; methods and defaults are unsupported")
                continue
            name, source = match.groups()
            if keyword.iskeyword(name):
                self.error(line.number, f"record field '{name}' is a keyword")
            if name in fields:
                self.error(line.number, f"duplicate record field '{name}'")
            fields.add(name)
            declaration.parameters.append(name)
            self.type_source(source, line.number)

    def port(self, declaration: Declaration) -> None:
        entries: dict[str, int] = {}
        for line in declaration.body:
            if not self.flat(line, declaration):
                continue
            match = re.fullmatch(r"(effect|contract|bind)\s+(.+)", line.text)
            if not match:
                self.error(line.number, "ports allow only effect, contract, and optional bind entries")
                continue
            kind, value = match.groups()
            if kind in entries:
                self.error(line.number, f"duplicate port {kind}")
            entries[kind] = line.number
            if kind == "contract":
                self.quoted(value, line.number)
            elif kind == "bind":
                if value not in self.references:
                    self.error(line.number, f"bind must name a declared ref; unknown ref '{value}'")
            else:
                effects = [part.strip() for part in value.split(",")]
                if any(part not in {"pure", "read", "write", "external"} for part in effects):
                    self.error(line.number, "effect categories are pure, read, write, external")
                if len(set(effects)) != len(effects):
                    self.error(line.number, "duplicate effect category")
                if "pure" in effects and len(effects) != 1:
                    self.error(line.number, "pure cannot be combined with other effect categories")
        for kind in ("effect", "contract"):
            if kind not in entries:
                self.error(declaration.line.number, f"port requires exactly one {kind}")

    def call(self, node: ast.Call, line: int, asynchronous: bool) -> None:
        for argument in node.args:
            if isinstance(argument, ast.Starred):
                self.error(line, "starred call arguments are unsupported")
            else:
                self.expression(argument, line, asynchronous)
        keywords: list[str] = []
        for argument in node.keywords:
            if argument.arg is None:
                self.error(line, "** call arguments are unsupported")
            else:
                keywords.append(argument.arg)
            self.expression(argument.value, line, asynchronous)
        if len(set(keywords)) != len(keywords):
            self.error(line, "duplicate keyword argument")
        if isinstance(node.func, ast.Name):
            name = node.func.id
            declaration = self.declarations.get(name)
            if declaration and declaration.kind in {"fn", "port", "record"}:
                parameters = declaration.parameters
                if declaration.kind == "record" and node.args:
                    self.error(line, f"record '{name}' must be constructed with named fields")
                if len(node.args) > len(parameters):
                    self.error(line, f"too many positional arguments for '{name}'")
                unknown = set(keywords) - set(parameters)
                if unknown:
                    self.error(line, f"unknown argument(s) for '{name}': {', '.join(sorted(unknown))}")
                assigned = set(parameters[:len(node.args)])
                if assigned.intersection(keywords):
                    self.error(line, f"argument supplied twice for '{name}'")
                missing = set(parameters) - assigned - set(keywords)
                if missing:
                    self.error(line, f"missing argument(s) for '{name}': {', '.join(sorted(missing))}")
            elif name in PRIMITIVES:
                limits = {"len": (1, 1), "abs": (1, 1), "sorted": (1, 1),
                          "range": (1, 3), "Decimal": (1, 1), "sum": (1, 2),
                          "min": (1, None), "max": (1, None)}
                minimum, maximum = limits[name]
                if keywords or len(node.args) < minimum or (maximum is not None and len(node.args) > maximum):
                    self.error(line, f"unsupported argument shape for primitive '{name}'; use positional arguments")
            else:
                self.error(line, f"call '{name}' must name a declared fn, port, record, or pure primitive")
        elif isinstance(node.func, ast.Attribute):
            self.expression(node.func.value, line, asynchronous)
            allowed = {"append": (1, 1), "get": (1, 2), "keys": (0, 0), "values": (0, 0), "items": (0, 0)}
            limits = allowed.get(node.func.attr)
            if limits is None:
                self.error(line, f"method '{node.func.attr}' is unsupported; declare a port")
            elif keywords or not limits[0] <= len(node.args) <= limits[1]:
                self.error(line, f"unsupported arguments for collection method '{node.func.attr}'")
        else:
            self.error(line, "calls through computed values are unsupported; declare a port")

    def expression(self, node: ast.expr, line: int, asynchronous: bool = False) -> None:
        if isinstance(node, ast.Constant):
            if node.value is not None and type(node.value) not in {str, int, float, bool}:
                self.error(line, "unsupported literal; bytes, complex numbers, and ellipses are unavailable")
        elif isinstance(node, ast.Name):
            if not re.fullmatch(IDENT, node.id):
                self.error(line, "names must be ASCII identifiers")
        elif isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            for item in node.elts:
                self.expression(item, line, asynchronous)
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if key is None:
                    self.error(line, "dictionary unpacking is unsupported")
                else:
                    self.expression(key, line, asynchronous)
                self.expression(value, line, asynchronous)
        elif isinstance(node, ast.Attribute):
            if not re.fullmatch(IDENT, node.attr) or node.attr.startswith("__"):
                self.error(line, "unsupported field name or reflection access")
            self.expression(node.value, line, asynchronous)
        elif isinstance(node, ast.Subscript):
            self.expression(node.value, line, asynchronous)
            if isinstance(node.slice, ast.Slice):
                for part in (node.slice.lower, node.slice.upper, node.slice.step):
                    if part is not None:
                        self.expression(part, line, asynchronous)
            else:
                self.expression(node.slice, line, asynchronous)
        elif isinstance(node, ast.Call):
            self.call(node, line, asynchronous)
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow)):
            self.expression(node.left, line, asynchronous)
            self.expression(node.right, line, asynchronous)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub, ast.Not)):
            self.expression(node.operand, line, asynchronous)
        elif isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            for value in node.values:
                self.expression(value, line, asynchronous)
        elif isinstance(node, ast.Compare):
            self.expression(node.left, line, asynchronous)
            left = node.left
            for operator, right in zip(node.ops, node.comparators):
                if not isinstance(operator, (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Is, ast.IsNot)):
                    self.error(line, "unsupported comparison")
                if isinstance(operator, (ast.Is, ast.IsNot)) and not any(
                    isinstance(value, ast.Constant) and value.value is None for value in (left, right)
                ):
                    self.error(line, "identity comparisons are supported only with None")
                self.expression(right, line, asynchronous)
                left = right
        elif isinstance(node, ast.IfExp):
            for value in (node.test, node.body, node.orelse):
                self.expression(value, line, asynchronous)
        elif isinstance(node, ast.Await):
            if not asynchronous:
                self.error(line, "await is allowed only inside async fn bodies")
            if not isinstance(node.value, ast.Call):
                self.error(line, "await must apply to a call")
            self.expression(node.value, line, asynchronous)
        else:
            self.error(line, f"unsupported expression syntax: {type(node).__name__}")

    def statements(self, nodes: list[ast.stmt], declaration: Declaration, asks: dict[int, str], loop_depth: int = 0,
                   indent: int = 4, prose_depth: int = 0) -> None:
        for node in nodes:
            line = node.lineno
            if node.col_offset != indent:
                self.error(line, f"suite statements need {indent} spaces; inline suites and indentation jumps are unsupported")
            if line in asks:
                continue
            if line in self.native_blocks:
                if isinstance(node, ast.If) and node.orelse:
                    self.error(line, "native blocks cannot have an else or elif branch")
                continue
            if line in self.alias_invocations:
                if isinstance(node, ast.If):
                    self.statements(node.body, declaration, asks, loop_depth, indent + 4, prose_depth + 1)
                    if node.orelse:
                        self.error(line, "alias invocations cannot have an else or elif branch")
                continue
            if line in self.prose_lines:
                if isinstance(node, ast.If):
                    self.statements(node.body, declaration, asks, loop_depth, indent + 4, prose_depth + 1)
                    is_elif = bool(node.orelse and isinstance(node.orelse[0], ast.If) and
                                   re.match(r"elif\b", self.line_text.get(node.orelse[0].lineno, "")))
                    self.statements(node.orelse, declaration, asks, loop_depth,
                                    indent if is_elif else indent + 4, prose_depth + 1)
                continue
            if isinstance(node, ast.Assign):
                if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
                    self.error(line, "assignment target must be one local name")
                else:
                    self.expression(node.targets[0], line, declaration.asynchronous)
                self.expression(node.value, line, declaration.asynchronous)
            elif isinstance(node, ast.If):
                self.expression(node.test, line, declaration.asynchronous)
                self.statements(node.body, declaration, asks, loop_depth, indent + 4, prose_depth)
                is_elif = bool(node.orelse and isinstance(node.orelse[0], ast.If) and
                               re.match(r"elif\b", self.line_text.get(node.orelse[0].lineno, "")))
                self.statements(node.orelse, declaration, asks, loop_depth,
                                indent if is_elif else indent + 4, prose_depth)
            elif isinstance(node, (ast.For, ast.While)):
                if isinstance(node, ast.For):
                    if not isinstance(node.target, ast.Name):
                        self.error(line, "for target must be one local name")
                    else:
                        self.expression(node.target, line, declaration.asynchronous)
                    self.expression(node.iter, line, declaration.asynchronous)
                else:
                    self.expression(node.test, line, declaration.asynchronous)
                self.statements(node.body, declaration, asks, loop_depth + 1, indent + 4, prose_depth)
                if node.orelse:
                    self.error(line, "loop else blocks are unsupported")
            elif isinstance(node, (ast.Break, ast.Continue)):
                if loop_depth == 0 and prose_depth == 0:
                    self.error(line, "break and continue require an enclosing loop")
            elif isinstance(node, ast.Return):
                if node.value is not None:
                    self.expression(node.value, line, declaration.asynchronous)
            elif isinstance(node, ast.Expr):
                if not isinstance(node.value, (ast.Call, ast.Await)):
                    self.error(line, "expression statements must be calls")
                self.expression(node.value, line, declaration.asynchronous)
            elif isinstance(node, ast.Raise):
                if node.exc is None or node.cause is not None:
                    self.error(line, "raise requires an expression; bare raise and 'from' are unsupported")
                if node.exc is not None:
                    self.expression(node.exc, line, declaration.asynchronous)
            elif isinstance(node, ast.Try):
                self.statements(node.body, declaration, asks, loop_depth, indent + 4, prose_depth)
                if node.orelse:
                    self.error(line, "try else blocks are unsupported")
                for handler in node.handlers:
                    if not isinstance(handler.type, ast.Name) or not re.fullmatch(IDENT, handler.type.id):
                        self.error(handler.lineno, "except must name one error type")
                    if handler.name is not None and not re.fullmatch(IDENT, handler.name):
                        self.error(handler.lineno, "exception binding must be an ASCII name")
                    self.statements(handler.body, declaration, asks, loop_depth, indent + 4, prose_depth)
                self.statements(node.finalbody, declaration, asks, loop_depth, indent + 4, prose_depth)
            else:
                self.error(line, f"unsupported statement syntax: {type(node).__name__}")

    def counted_loop(self, line: Line, asynchronous: bool) -> str | None:
        match = re.fullmatch(rf"for\s+({IDENT})\s*=\s*(.*):", line.text)
        if not match:
            return None
        name, source = match.groups()
        if self.version != "0.3":
            self.error(line.number, "inclusive counted loops require plainlogic 0.3")
        separators: list[tuple[int, int]] = []
        depth = 0
        try:
            for token in tokenize.generate_tokens(io.StringIO(source).readline):
                if token.type == tokenize.OP:
                    if token.string in "([{":
                        depth += 1
                    elif token.string in ")]}":
                        depth -= 1
                if depth == 0 and token.type == tokenize.NAME and token.string == "to":
                    separators.append((token.start[1], token.end[1]))
        except (tokenize.TokenError, IndentationError, SyntaxError):
            pass
        if len(separators) != 1:
            self.error(line.number, "counted loop syntax is: for name = first to last:")
        else:
            start, end = separators[0]
            # Parse each original bound independently. Inserting the raw text into
            # a Python wrapper could otherwise change the wrapper's AST shape.
            for bound in (source[:start].strip(), source[end:].strip()):
                expression = self.parse_expression(bound, line.number)
                if expression is not None:
                    self.expression(expression, line.number, asynchronous)
        return f"for {name} in (None, None):"

    def alias_target(self, line: Line, name: str) -> None:
        if self.version != "0.3":
            self.error(line.number, "alias invocations require plainlogic 0.3")
        declaration = self.declarations.get(name)
        if declaration is None or declaration.kind != "alias" or name in self.duplicate_names:
            self.error(line.number, f"alias invocation must name one declared, unambiguous alias; unknown or ambiguous alias '{name}'")

    def executable(self, declaration: Declaration, executable: list[Line], root_alias: bool = False) -> None:
        asks: dict[int, str] = {}
        source = [""] * (len(self.source.splitlines()) + 1)
        source[declaration.line.number - 1] = (
            "def __plainlogic_root__():" if root_alias else self.python_header(declaration)
        )
        for line in executable:
            if line.number in self.native_blocks:
                source[line.number - 1] = " " * line.indent + "if True:"
                body = self.native_blocks[line.number]
                if body:
                    source[body[0] - 1] = " " * (line.indent + 4) + "None"
                continue
            if line.number in self.prose_lines:
                placeholder = "if True:" if self.prose_lines[line.number] else "None"
                source[line.number - 1] = " " * line.indent + placeholder
                continue
            match = re.fullmatch(rf"({IDENT})\s*:", line.text)
            if match and match.group(1) not in RESERVED | EXTENSION_RESERVED:
                name = match.group(1)
                self.alias_invocations[line.number] = name
                self.alias_target(line, name)
                source[line.number - 1] = " " * line.indent + "if True:"
                continue
            counted = self.counted_loop(line, declaration.asynchronous)
            if counted is not None:
                source[line.number - 1] = " " * line.indent + counted
                continue
            match = re.fullmatch(rf"ask\s+({IDENT})", line.text)
            if match:
                name = match.group(1)
                asks[line.number] = name
                if name not in self.questions:
                    self.error(line.number, f"ask must name a declared open question; unknown question '{name}'")
                if self.state != "draft":
                    self.error(line.number, "ask is legal only in a draft")
                source[line.number - 1] = " " * line.indent + "None"
            else:
                source[line.number - 1] = " " * line.indent + line.text
        try:
            module = ast.parse("\n".join(source))
        except (SyntaxError, ValueError, RecursionError) as exc:
            line = exc.lineno if isinstance(exc, SyntaxError) and exc.lineno else declaration.line.number
            detail = exc.msg if isinstance(exc, SyntaxError) else "routine is too complex"
            self.error(line, f"invalid routine syntax: {detail}")
            return
        if len(module.body) != 1 or not isinstance(module.body[0], (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.error(declaration.line.number, "invalid routine body")
            return
        self.statements(module.body[0].body, declaration, asks, prose_depth=1 if root_alias else 0)

    def function(self, declaration: Declaration) -> None:
        body = declaration.body
        if not body:
            return
        cover_line = body[0]
        match = re.fullmatch(r"covers\s+(.+)", cover_line.text)
        if cover_line.indent != 4 or not match:
            self.error(cover_line.number, "the first fn entry must be covers R1, R2, ...")
            executable = body
        else:
            self.coverage(cover_line)
            executable = body[1:]
        if not executable:
            self.error(declaration.line.number, "fn needs an executable body or draft ask after covers")
            return
        self.executable(declaration, executable)

    def case(self, declaration: Declaration) -> None:
        given: set[str] = set()
        for line in declaration.body:
            if not self.flat(line, declaration):
                continue
            match = re.fullmatch(rf"given\s+({IDENT})\s*=\s*(.+)", line.text)
            if match:
                name, source = match.groups()
                if keyword.iskeyword(name):
                    self.error(line.number, f"given name '{name}' is a keyword")
                if name in given:
                    self.error(line.number, f"duplicate given name '{name}'")
                given.add(name)
                expression = self.parse_expression(source, line.number)
                if expression is not None:
                    self.expression(expression, line.number)
                continue
            match = re.fullmatch(r"expect\s+(.+)", line.text)
            if match:
                expression = self.parse_expression(match.group(1), line.number)
                if expression is not None:
                    self.expression(expression, line.number)
                continue
            if line.text.startswith("stub "):
                source = line.text[5:]
                split: int | None = None
                depth = 0
                try:
                    for token in tokenize.generate_tokens(io.StringIO(source).readline):
                        if token.type == tokenize.OP:
                            if token.string in "([{":
                                depth += 1
                            elif token.string in ")]}":
                                depth -= 1
                        if depth == 0 and token.type == tokenize.NAME and token.string == "returns":
                            split = token.start[1]
                            break
                except (tokenize.TokenError, IndentationError):
                    pass
                if split is None:
                    self.error(line.number, "stub syntax is: stub port_call(...) returns expression")
                    continue
                call = self.parse_expression(source[:split].strip(), line.number)
                result = self.parse_expression(source[split + len("returns"):].strip(), line.number)
                if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or not (
                    call.func.id in self.declarations and self.declarations[call.func.id].kind == "port"
                ):
                    self.error(line.number, "stub must describe a declared port call")
                if call is not None:
                    self.expression(call, line.number)
                if result is not None:
                    self.expression(result, line.number)
                continue
            self.error(line.number, "case entries must be given, stub ... returns, or expect")

    def run(self) -> list[Diagnostic]:
        self.lex()
        if self.diagnostics:
            return self.diagnostics
        self.collect()
        executable_lines = {line.number for declaration in self.blocks if declaration.kind in {"fn", "alias-unit"}
                            for line in declaration.body}
        for line in self.prose_lines:
            if self.version not in {"0.2", "0.3"}:
                self.error(line, "prose steps require plainlogic 0.2 or 0.3")
            if line not in executable_lines:
                self.error(line, "prose steps are allowed only inside fn or alias-invocation bodies")
        if self.version in {"0.2", "0.3"} and self.prose_lines:
            self.diagnostics.append(Diagnostic(min(self.prose_lines),
                "prose accepted structurally only; meaning, feasibility, and control-flow targets require semantic validation",
                "warning"))
        root_native = {block.line.number for block in self.blocks if block.kind == "native"}
        for line in self.native_blocks:
            if self.version != "0.3":
                self.error(line, "native blocks require plainlogic 0.3")
            if line not in executable_lines | root_native:
                self.error(line, "native blocks are allowed only at document top level or inside executable bodies")
        if self.native_blocks and self.version == "0.3":
            self.diagnostics.append(Diagnostic(min(self.native_blocks),
                "native content is protected literal text; target syntax, interfaces, effects, and feasibility remain unverified",
                "warning"))
        # Collect every signature and record field before checking forward calls.
        for declaration in self.blocks:
            if declaration.kind == "record":
                self.record(declaration)
        for declaration in self.blocks:
            if declaration.kind == "port":
                self.port(declaration)
            elif declaration.kind == "fn":
                self.function(declaration)
            elif declaration.kind == "alias-unit":
                self.alias_target(declaration.line, declaration.name)
                if declaration.body:
                    self.executable(declaration, declaration.body, root_alias=True)
            elif declaration.kind == "case":
                self.case(declaration)
        aliases = [declaration.line.number for declaration in self.declarations.values() if declaration.kind == "alias"]
        if (aliases or self.alias_invocations) and self.version == "0.3":
            self.diagnostics.append(Diagnostic(min(aliases + list(self.alias_invocations)),
                "aliases accepted structurally only; body execution count, scheduling, capture, lifetime, failures, and control-flow targets require semantic validation",
                "warning"))
        if self.require_ready and self.state != "ready":
            self.error(3, "--ready requires state ready")
        if self.state == "ready":
            for name in sorted(self.questions):
                self.error(self.declarations[name].line.number, "open questions are legal only in a draft")
            missing = self.requirements - self.covered
            if missing:
                self.error(3, f"ready document has uncovered requirement(s): {', '.join(sorted(missing))}")
        if not any(declaration.kind == "case" for declaration in self.blocks):
            self.diagnostics.append(Diagnostic(1, "no reviewable cases; examples are recommended", "warning"))
        return sorted(self.diagnostics, key=lambda diagnostic: (diagnostic.line, diagnostic.severity, diagnostic.message))


def check_text(source: str, ready: bool = False) -> list[Diagnostic]:
    """Return structural diagnostics; this does not establish behavioral correctness."""
    return Checker(source, ready).run()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="UTF-8 .plog document to check")
    parser.add_argument("--ready", action="store_true", help="also require state ready")
    arguments = parser.parse_args(argv)
    try:
        source = arguments.file.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        print(f"{arguments.file}:1: error: cannot read UTF-8 document: {exc}", file=sys.stderr)
        return 1
    diagnostics = check_text(source, arguments.ready)
    for diagnostic in diagnostics:
        print(f"{arguments.file}:{diagnostic.line}: {diagnostic.severity}: {diagnostic.message}")
    errors = sum(diagnostic.severity == "error" for diagnostic in diagnostics)
    warnings = sum(diagnostic.severity == "warning" for diagnostic in diagnostics)
    print(f"Checked structure: {errors} error(s), {warnings} warning(s). No code executed; references and types unverified.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
