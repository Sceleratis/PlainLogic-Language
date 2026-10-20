"""Sync portable skill resources and create self-contained agent plugin/skill ZIPs."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys
import zipfile
import json


ROOT = Path(__file__).resolve().parent.parent
SKILL = Path("skills/plainlogic")
GENERATED = "<!-- Generated resource; maintained in the source repository. -->\n\n"


def contained(root: Path, path: Path) -> Path:
    """Reject package paths that resolve outside their explicit source root."""
    root = root.resolve()
    candidate = path.resolve()
    if not candidate.is_relative_to(root):
        raise ValueError(f"Package path escapes root: {path}")
    return candidate


def resource_bytes(root: Path) -> dict[Path, bytes]:
    """Resources derive from the repo language/tool sources, never a user's skill cache."""
    resources: dict[Path, bytes] = {}
    for source in ("docs/plainlogic.md", "docs/extensibility.md"):
        path = contained(root, root / source)
        text = path.read_text(encoding="utf-8")
        text = text.replace("python tools/check_plainlogic.py", "python <skill-directory>/scripts/check_plainlogic.py")
        text = text.replace("From the repository root, run the optional Python canonical checker:",
                            "Run the bundled optional Python canonical checker:")
        if "tools/check_plainlogic.py" in text:
            raise ValueError(f"Generated reference still points at the repository checker path: {source}. "
                             "The docs wording the generator rewrites may have changed.")
        resources[SKILL / "references" / path.name] = (GENERATED + text).encode("utf-8")
    resources[SKILL / "scripts/check_plainlogic.py"] = generated_checker(
        contained(root, root / "tools/check_plainlogic.py").read_bytes())
    resources[SKILL / "scripts/case_to_tests.py"] = generated_checker(
        contained(root, root / "tools/case_to_tests.py").read_bytes(), origin=b"tools/case_to_tests.py")
    for example in sorted((root / "examples").glob("*.plog")):
        resources[SKILL / "assets/examples" / example.name] = contained(root, example).read_bytes()
    conversions = root / "examples" / "conversions"
    if conversions.is_dir():
        for pair in sorted(path for path in conversions.rglob("*") if path.is_file()):
            resources[SKILL / "assets/conversions" / pair.relative_to(conversions)] = \
                contained(root, pair).read_bytes()
    return resources


CHECKER_BANNER = (b"# Generated resource; maintained in the source repository "
                  b"(tools/check_plainlogic.py). Do not edit this copy; it is overwritten on sync.")


def generated_checker(source: bytes, origin: bytes = b"tools/check_plainlogic.py") -> bytes:
    """Prepend the generated-file banner, keeping the shebang first and the
    source's own line-ending style for the banner line."""
    ending = b"\r\n" if source.startswith(b"#!") and b"\r\n" in source[:200] else (
        b"\r\n" if b"\r\n" in source[:200] else b"\n")
    banner = CHECKER_BANNER.replace(b"tools/check_plainlogic.py", origin)
    if source.startswith(b"#!"):
        head, _, rest = source.partition(b"\n")
        return head + b"\n" + banner + ending + rest
    return banner + ending + source


def synchronize(root: Path, check: bool = False) -> list[Path]:
    stale = []
    for relative, content in resource_bytes(root).items():
        destination = root / relative
        contained(root, destination)
        if destination.is_file() and destination.read_bytes() == content:
            continue
        stale.append(relative)
        if not check:
            destination.parent.mkdir(parents=True, exist_ok=True)
            contained(root, destination)
            destination.write_bytes(content)
    return stale


DISTRIBUTABLE_SUFFIXES = {".md", ".py", ".plog", ".yaml", ".yml", ".json", ".ts", ".cs"}


def tree_files(root: Path, directory: Path) -> list[Path]:
    """Use ordinary contained files only; only distributable suffixes can enter
    a distribution, so caches, .env files, editor backups, and drafts left in
    the skill tree cannot ship silently."""
    contained(root, directory)
    result = []
    for path in sorted(directory.rglob("*")):
        contained(root, path)
        if path.is_file() and "__pycache__" not in path.parts and path.suffix in DISTRIBUTABLE_SUFFIXES:
            result.append(path)
    return result


def check_skill_links(root: Path) -> None:
    base = contained(root, root / SKILL)
    for path in tree_files(root, base):
        if path.suffix != ".md":
            continue
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
            if "://" in target or target.startswith("#"):
                continue
            relative = target.split("#", 1)[0]
            resolved = contained(base, path.parent / relative)
            if not resolved.exists():
                raise ValueError(f"Missing bundled skill reference: {path}: {target}")


def write_zip(destination: Path, entries: dict[str, bytes]) -> None:
    """Stable timestamps/order make repeated exports identical."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3  # Unix, on every host: zipfile otherwise derives it from the OS.
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)


def package(root: Path, output: Path | None = None) -> list[Path]:
    synchronize(root)
    check_skill_links(root)
    manifest = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version):
        raise ValueError("A filename-safe semantic plugin version is required for packaging.")
    output = contained(root, output or root / "dist")
    files = tree_files(root, root / SKILL)
    standalone = {path.relative_to(root / "skills").as_posix(): path.read_bytes() for path in files}
    plugin = {path.relative_to(root).as_posix(): path.read_bytes() for path in files}
    for relative in ("plugin.json", ".codex-plugin/plugin.json", ".agents/plugins/marketplace.json",
                     ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "docs/agents.md"):
        plugin[relative] = contained(root, root / relative).read_bytes()
    plugin["README.md"] = (
        "# PlainLogic agent package\n\n"
        "Read docs/agents.md for Codex, Claude Code, and standalone Agent Skills installation.\n"
        "The main skill is skills/plainlogic/SKILL.md. All required resources are bundled.\n"
        "A file or specification selects implementation; write and validate are explicit modes.\n"
        "This package contains agent instructions, not a deterministic prose compiler.\n"
    ).encode("utf-8")
    paths = [output / f"plainlogic-agents-{version}.zip", output / f"plainlogic-skill-{version}.zip"]
    for path in paths:
        contained(root, path)
    write_zip(paths[0], plugin)
    write_zip(paths[1], standalone)
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--sync", action="store_true", help="update generated portable skill resources")
    mode.add_argument("--check", action="store_true", help="check generated resources without writing")
    mode.add_argument("--package", action="store_true", help="sync/check and write distribution ZIPs")
    args = parser.parse_args()
    try:
        if args.package:
            for path in package(ROOT):
                print(path.relative_to(ROOT))
        else:
            stale = synchronize(ROOT, check=args.check)
            if args.check and stale:
                print("Stale skill resources; run npm run agents:sync:", file=sys.stderr)
                for path in stale:
                    print(path.as_posix(), file=sys.stderr)
                return 1
            check_skill_links(ROOT)
            print(f"Portable skill resources {'checked' if args.check else 'synced'} ({len(stale)} changed).")
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        print(f"Agent packaging failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
