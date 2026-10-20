# PlainLogic for coding agents

The **PlainLogic** skill implements PlainLogic or specifications in an existing codebase. It also writes and validates logic when requested. The portable skill lives in [`skills/plainlogic/`](../skills/plainlogic/); the VS Code extension is a separate editor aid.

The machine identifier is lowercase `plainlogic`, as required by the [Agent Skills naming rules](https://agentskills.io/specification). Its display name is **PlainLogic**.

## Use the skill

After installation, these are agent prompts, not shell commands:

| Input | Expected work |
| --- | --- |
| `plainlogic feature.plog` | Validate the logic, then implement it in the target project. |
| `plainlogic docs/requirements.md` | Read the requirements, derive reviewable logic, resolve consequential gaps, and implement the requested behavior. |
| `plainlogic src/request.lua` | Implement the explicit PlainLogic regions in that file, using its existing language and surrounding code. |
| `plainlogic write docs/requirements.md` | Produce or refine pseudocode without implementing it. |
| `plainlogic validate feature.plog` | Check coherence, feasibility, source compatibility, and material ambiguity without implementing it. |

Use the agent's native invocation syntax when calling the skill explicitly:

```text
# Codex, standalone skill
$plainlogic feature.plog
$plainlogic write docs/requirements.md
$plainlogic validate feature.plog

# Claude Code, installed plugin or --plugin-dir
/plainlogic:plainlogic feature.plog
/plainlogic:plainlogic src/request.lua

# Claude Code, standalone skill copied to .claude/skills
/plainlogic feature.plog
```

Bare file or specification input defaults to implementation. An explicit request to explain, write, or validate takes precedence. In a source file, only the selected pseudocode regions are converted; ordinary comments and existing implementation code are context. See the [skill instructions](../skills/plainlogic/SKILL.md) for region boundaries and behavior when intent is unclear.

For a Codex plugin installation, select **PlainLogic** from the skill picker, which may show the plugin namespace, or say **Use PlainLogic on src/request.lua**. The short dollar invocation above describes a standalone skill; client versions may display plugin-qualified names.

For an explicit conversion region, use standalone comments in the target language:

```python
def sum_positive(values):
    # plainlogic:start
    # > Add all values greater than zero.
    # > Return their sum, or zero when there are none.
    # plainlogic:end
```

Calling PlainLogic on this file replaces the markers and instructions with the function body. It can also recognize unmistakable raw PlainLogic in code positions. Marker text in strings or documentation, ordinary comments, and comparison operators remain ordinary source text. An unclosed or overlapping region needs clarification; a file with no intentional instructions is left unchanged. Consumed markers are removed so repeating conversion does not implement the same instructions twice. See [source-file conversion](../skills/plainlogic/references/conversion.md).

This is an agent workflow, not a deterministic compiler. The agent validates before implementing, grounds references in available source, and asks about consequential unresolved behavior. Structural checker success does not establish that prose is feasible or semantically complete.

## Install as a plugin

From the root of a local checkout, choose your client. These commands register a marketplace and install its plugin in that client's configuration; packaging the repository does not run them.

### Codex

```powershell
codex plugin marketplace add .
codex plugin add plainlogic@plainlogic-local
```

Start a new session in the project you want to change and invoke PlainLogic. In Codex desktop, the registered marketplace can also be opened in the plugin directory. [OpenAI's plugin packaging and marketplace instructions](https://developers.openai.com/plugins/build/plugins) describe the supported package formats and local catalogs. The exact CLI commands above are supported by Codex CLI 0.154.0.

### Claude Code

```powershell
claude plugin marketplace add .
claude plugin install plainlogic@plainlogic-local
```

Restart the session after installation. For a temporary development session without registering the marketplace:

```powershell
claude --plugin-dir .
```

The skill is `/plainlogic:plainlogic`: the first name is the plugin, and the second is its skill. See [Claude's plugin installation instructions](https://code.claude.com/docs/en/discover-plugins) and [marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).

### Install from GitHub

Once the required files are available on the repository's remote default branch, users can replace the local marketplace path with the repository name:

```powershell
codex plugin marketplace add Sceleratis/PlainLogic-Language
codex plugin add plainlogic@plainlogic-local

claude plugin marketplace add Sceleratis/PlainLogic-Language
claude plugin install plainlogic@plainlogic-local
```

GitHub installation reads the remote repository and will not include changes that exist only in a local checkout. Local and GitHub commands register the same marketplace name; choose the source you want to track instead of registering both.

## Install as a standalone Agent Skill

Copy the entire `skills/plainlogic/` folder, including its `references/`, `scripts/`, and `assets/`, into the directory your agent uses for skills. No plugin loader is required when the agent supports [Agent Skills](https://agentskills.io/specification).

For a project-local installation, the resulting entry point is:

| Client | Entry point |
| --- | --- |
| Codex | `<your-project>/.agents/skills/plainlogic/SKILL.md` |
| Claude Code | `<your-project>/.claude/skills/plainlogic/SKILL.md` |
| Another Agent Skills client | Its documented skill discovery location, with the same complete `plainlogic/` folder. |

These locations follow the [Codex skill discovery documentation](https://developers.openai.com/codex/skills/) and [Claude Code skill locations](https://code.claude.com/docs/en/skills). This repository does not copy files into your projects automatically. Choose either standalone installation or the plugin to avoid loading duplicate copies of the same skill.

## Package and validate

```powershell
npm run package:agents
```

The packaging command produces:

- `dist/plainlogic-agents-0.3.0.zip`: the plugin with its portable and client compatibility manifests, marketplaces, and complete skill.
- `dist/plainlogic-skill-0.3.0.zip`: the standalone `plainlogic/` skill folder.

The skill's language reference, examples, and checker are generated from the repository's maintained sources. Regenerate them after changing those sources. The packaged skill resolves its resources from its own installation location and does not depend on the original checkout or its `node_modules` directory. Python 3 is needed to run the bundled structural checker; interpretation and implementation use the agent's existing tools.

```powershell
npm run agents:sync
npm run agents:check
```

`agents:sync` refreshes the generated skill resources; `agents:check` checks for drift without changing them. The `plainlogic` invocation examples are prompts to an agent, not a new compiler CLI executable.

Run the focused packaging checks without registering or installing a plugin:

```powershell
node --test test/plugin-manifests.test.js
claude plugin validate ./.claude-plugin/plugin.json
claude plugin validate ./.claude-plugin/marketplace.json
```

Explicit manifest paths check both files even on Claude Code versions that prioritize the marketplace when validating a directory. These commands were supported by Claude Code 2.1.118. Newer validation flags vary by version; check `claude plugin validate --help`. [Claude's validation reference](https://code.claude.com/docs/en/plugins/cli-reference) explains what validation establishes. Manifest validation does not exercise agent reasoning or perform implementation.

## Portable format and compatibility

Root [`plugin.json`](../plugin.json) targets **Agent Plugins 1.0.0**, with the exact [versioned JSON Schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json). The portable standard discovers skills in `skills/`; there is no portable top-level `skills` manifest field. OpenAI presentation metadata is under `extensions.com.openai`. [Agent Plugins](https://agent-plugins.org/) standardizes the package; installation and invocation remain client-specific.

The small `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json` overlays use the same plugin identity and skill tree. Codex's overlay supports its compatibility layout. Claude's overlay supplies its native plugin metadata. There are no alternate copies of the skill instructions, lifecycle hooks, MCP servers, or automatic plugin activation settings.

The Codex catalog is `.agents/plugins/marketplace.json`; the Claude catalog is `.claude-plugin/marketplace.json`. Both point to `./`, resolved from the repository or extracted plugin root. These paths are not relative to the hidden manifest directories. All bundled skill resources remain inside the package, consistent with the [standard's containment requirements](https://agent-plugins.org/specification).

Compatibility claims are limited to the portable format and the documented Codex and Claude loading layouts. Other clients may support Agent Skills without supporting Agent Plugins, or may require their own installation steps.
