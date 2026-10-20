"""Portable export invariants, including independence from the developer checkout."""

from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("agent_packager", REPO / "tools/package_agents.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class AgentPackageTests(unittest.TestCase):
    def fixture(self, base):
        for relative in ("docs/plainlogic.md", "docs/extensibility.md", "tools/check_plainlogic.py",
                         "examples/sample.plog", "skills/plainlogic/SKILL.md",
                         ".codex-plugin/plugin.json", ".agents/plugins/marketplace.json",
                         ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "docs/agents.md"):
            path = base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture\n", encoding="utf-8")
        (base / "plugin.json").write_text(json.dumps({"name": "plainlogic", "version": "0.3.0"}), encoding="utf-8")
        (base / "skills/plainlogic/SKILL.md").write_text(
            "---\nname: plainlogic\ndescription: Fixture.\n---\n[Language](references/plainlogic.md)\n",
            encoding="utf-8")
        (base / "docs/plainlogic.md").write_text(
            "python tools/check_plainlogic.py input.plog\n[Extensions](extensibility.md)\n",
            encoding="utf-8")

    def test_resources_check_detects_stale_without_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            stale = packager.synchronize(root, check=True)
            self.assertTrue(stale)
            self.assertFalse((root / "skills/plainlogic/references/plainlogic.md").exists())
            packager.synchronize(root)
            self.assertEqual([], packager.synchronize(root, check=True))
            (root / "docs/plainlogic.md").write_text("updated source\n", encoding="utf-8")
            self.assertIn(Path("skills/plainlogic/references/plainlogic.md"), packager.synchronize(root, check=True))

    def test_exports_have_self_contained_resources_and_no_caches(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            cache = root / "skills/plainlogic/__pycache__/junk.pyc"
            cache.parent.mkdir()
            cache.write_bytes(b"cache")
            plugin, skill = packager.package(root)
            with zipfile.ZipFile(plugin) as z:
                self.assertIsNone(z.testzip())
                self.assertIn("plugin.json", z.namelist())
                self.assertIn(".claude-plugin/plugin.json", z.namelist())
                self.assertIn(".agents/plugins/marketplace.json", z.namelist())
                self.assertIn("skills/plainlogic/scripts/check_plainlogic.py", z.namelist())
                self.assertFalse(any("__pycache__" in name or ".." in Path(name).parts for name in z.namelist()))
            with zipfile.ZipFile(skill) as z:
                self.assertIn("plainlogic/SKILL.md", z.namelist())
                self.assertIn("plainlogic/assets/examples/sample.plog", z.namelist())
                self.assertNotIn("plugin.json", z.namelist())
                self.assertIn(b"<skill-dir>/scripts/check_plainlogic.py",
                              z.read("plainlogic/references/plainlogic.md"))

    def test_archives_are_reproducible(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            paths = packager.package(root)
            first = [path.read_bytes() for path in paths]
            packager.package(root)
            self.assertEqual(first, [path.read_bytes() for path in paths])

    def test_outside_paths_and_broken_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            self.fixture(root)
            with self.assertRaises(ValueError):
                packager.contained(root, root / "../outside")
            packager.synchronize(root)
            (root / "skills/plainlogic/SKILL.md").write_text("[Outside](../../../../outside)\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                packager.check_skill_links(root)

    def test_actual_repo_resources_are_current_and_portable(self):
        self.assertEqual([], packager.synchronize(REPO, check=True))
        packager.check_skill_links(REPO)


if __name__ == "__main__":
    unittest.main()
