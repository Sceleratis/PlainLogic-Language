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
        for relative in ("docs/plainlogic.md", "docs/extensibility.md", "tools/check_plainlogic.py", "tools/case_to_tests.py",
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
                self.assertIn(b"<skill-directory>/scripts/check_plainlogic.py",
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

    def test_archives_pin_create_system_and_exclude_stray_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            stray_env = root / "skills/plainlogic/.env"
            stray_env.write_text("SECRET=1\n", encoding="utf-8")
            stray_draft = root / "skills/plainlogic/references/draft.txt"
            stray_draft.parent.mkdir(parents=True, exist_ok=True)
            stray_draft.write_text("draft\n", encoding="utf-8")
            plugin, skill = packager.package(root)
            for archive in (plugin, skill):
                with zipfile.ZipFile(archive) as z:
                    self.assertTrue(all(info.create_system == 3 for info in z.infolist()))
                    self.assertFalse(any(name.endswith(".env") or name.endswith("draft.txt")
                                         for name in z.namelist()))

    def test_dist_archives_match_current_sources_when_present(self):
        version = json.loads((REPO / "plugin.json").read_text(encoding="utf-8"))["version"]
        shipped = [REPO / "dist" / f"plainlogic-agents-{version}.zip",
                   REPO / "dist" / f"plainlogic-skill-{version}.zip"]
        if not all(path.exists() for path in shipped):
            self.skipTest("dist archives are not built in this checkout")
        def entries(path):
            with zipfile.ZipFile(path) as z:
                return {name: z.read(name) for name in z.namelist()}
        with tempfile.TemporaryDirectory(dir=REPO) as temp:
            rebuilt = packager.package(REPO, Path(temp))
            for shipped_path, rebuilt_path in zip(shipped, rebuilt):
                shipped_entries, rebuilt_entries = entries(shipped_path), entries(rebuilt_path)
                self.assertEqual(sorted(shipped_entries), sorted(rebuilt_entries),
                                 f"{shipped_path.name} is stale; rebuild the dist archives")
                for name in sorted(shipped_entries):
                    self.assertEqual(shipped_entries[name], rebuilt_entries[name],
                                     f"{shipped_path.name}:{name} is stale; rebuild the dist archives")

    def test_actual_repo_resources_are_current_and_portable(self):
        self.assertEqual([], packager.synchronize(REPO, check=True))
        packager.check_skill_links(REPO)


if __name__ == "__main__":
    unittest.main()
