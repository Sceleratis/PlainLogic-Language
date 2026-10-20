"""Checks for the case -> unit-test generator (tools/case_to_tests.py)."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("case_to_tests_under_test", ROOT / "tools" / "case_to_tests.py")
generator = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = generator
spec.loader.exec_module(generator)


def install_pytest_shim() -> None:
    shim = types.ModuleType("pytest")

    class Skip(Exception):
        pass

    def skip(reason: str = "") -> None:
        raise Skip(reason)

    shim.skip = skip  # type: ignore[attr-defined]
    shim.Skip = Skip  # type: ignore[attr-defined]
    sys.modules.setdefault("pytest", shim)


class Monkeypatch:
    def __init__(self) -> None:
        self.undo: list[tuple[object, str, object]] = []

    def setattr(self, dotted: str, value: object) -> None:
        module_name, _, attr = dotted.rpartition(".")
        module = sys.modules[module_name]
        self.undo.append((module, attr, getattr(module, attr)))
        setattr(module, attr, value)

    def restore(self) -> None:
        for module, attr, value in reversed(self.undo):
            setattr(module, attr, value)


def load_module(name: str, source: str, directory: str) -> types.ModuleType:
    path = Path(directory) / f"{name}.py"
    path.write_text(source, encoding="utf-8")
    module_spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(module_spec)
    sys.modules[name] = module
    module_spec.loader.exec_module(module)
    return module


QUOTE_IMPL = """
from dataclasses import dataclass

@dataclass
class Line:
    price_cents: int
    quantity: int

@dataclass
class Quote:
    subtotal_cents: int
    discount_cents: int
    total_cents: int

def quote(lines):
    subtotal = sum(line.price_cents * line.quantity for line in lines)
    discount = subtotal * 10 // 100 if subtotal >= 10000 else 0
    return Quote(subtotal_cents=subtotal, discount_cents=discount, total_cents=subtotal - discount)
"""

PORT_DOC = """
plainlogic 0.3
unit Loader
state ready
intent "Load one value through a port."
scope "Only the load."
require R1 "Return the loaded value."

port fetch(id: Int) -> Int:
    effect read
    contract "Fetch one value."

fn load(id: Int) -> Int:
    covers R1
    return fetch(id)

case doubled:
    given base = 21
    stub fetch(base) returns base * 2
    expect load(base) == 42
"""


class CaseToTestsTests(unittest.TestCase):
    def test_generated_python_tests_pass_against_an_implementation(self):
        install_pytest_shim()
        source = (ROOT / "examples" / "quote-total.plog").read_text(encoding="utf-8")
        generated = generator.generate(source, "python", "quote_impl", "quote-total.plog")
        compile(generated, "generated_tests.py", "exec")
        with tempfile.TemporaryDirectory() as directory:
            load_module("quote_impl", QUOTE_IMPL, directory)
            tests = load_module("generated_tests", generated, directory)
            for name in ("test_case_empty", "test_case_below_threshold", "test_case_threshold_and_rounding"):
                getattr(tests, name)()

    def test_stub_cases_become_monkeypatched_doubles(self):
        install_pytest_shim()
        generated = generator.generate(PORT_DOC, "python", "loader_impl", "loader.plog")
        self.assertIn('monkeypatch.setattr("loader_impl.fetch"', generated)
        with tempfile.TemporaryDirectory() as directory:
            load_module("loader_impl",
                        "def fetch(id):\n    raise AssertionError('real port called')\n\n"
                        "def load(id):\n    return fetch(id)\n", directory)
            tests = load_module("generated_loader_tests", generated, directory)
            patcher = Monkeypatch()
            try:
                tests.test_case_doubled(patcher)
            finally:
                patcher.restore()

    def test_typescript_output_camel_cases_and_skips_stub_cases(self):
        source = (ROOT / "examples" / "quote-total.plog").read_text(encoding="utf-8")
        generated = generator.generate(source, "typescript", "./quote-impl", "quote-total.plog")
        self.assertIn("subtotalCents: 0", generated)
        self.assertIn("toEqual", generated)
        stubbed = generator.generate(PORT_DOC, "typescript", "./loader-impl", "loader.plog")
        self.assertIn("it.skip", stubbed)

    def test_floor_division_and_modulo_render_for_typescript(self):
        source = (ROOT / "examples" / "mixed-total.plog").read_text(encoding="utf-8")
        generated = generator.generate(source, "typescript", "./mixed-impl", "mixed-total.plog")
        self.assertIn("totalPositive", generated)
        doc = ("plainlogic 0.3\nunit M\nstate draft\nintent \"i\"\nscope \"s\"\nrequire R1 \"r\"\n"
               "fn half(value: Int) -> Int:\n    covers R1\n    return value // 2\n\n"
               "case seven:\n    given v = 7\n    expect half(v) == 3\n")
        generated = generator.generate(doc, "typescript", "./m", "m.plog")
        self.assertIn("half(v)", generated)

    def test_checker_errors_block_generation(self):
        with self.assertRaises(ValueError):
            generator.generate("plainlogic 0.3\nunit Broken\n", "python", "x", "broken.plog")


if __name__ == "__main__":
    unittest.main()
