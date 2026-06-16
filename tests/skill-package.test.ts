import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const skillRoot = path.resolve(
  import.meta.dirname,
  "../skills/enforced-unlearning",
);

async function readSkillFile(relativePath: string): Promise<string> {
  return readFile(path.join(skillRoot, relativePath), "utf8");
}

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n").trimEnd();
}

describe("enforced-unlearning skill package", () => {
  it("matches SKILL.md exactly", async () => {
    const skillMd = await readSkillFile("SKILL.md");

    expect(normalize(skillMd)).toBe(
      normalize(`---
name: enforced-unlearning
description: Plan, apply, verify, enforce, inspect, or roll back project-level agent unlearning. Use when a user asks Codex or Claude Code to forget an instruction, preference, memory, or behavior while preserving an explicit retain boundary.
---

# Enforced Unlearning

Use the repository's \`unlearn\` CLI for deterministic filesystem operations.

## Workflow

1. Restate the exact forget target. If the user provides a retain boundary, restate it too.
2. Run \`unlearn plan "<target>"\`. If retain boundaries are provided, append them as positional arguments.
3. Show the affected files, proposed removals, retain boundary if provided, and probes.
4. Never run \`unlearn apply\` before explicit approval.
5. After approval, apply the plan through the configured agent adapter.
6. Report source removal, behavioral verification, and enforcement separately.
7. Default to warn, filter, and continue when forgotten content reappears.
8. Offer rollback when verification is partial or failed.

If no provider adapter is configured, \`unlearn apply\` and \`unlearn verify\` return \`inconclusive\` without claiming success.

Never claim model-weight unlearning. State that the Skill controls project files and staged agent inputs only.

Read \`references/claude-code.md\` only when preparing a later Claude Code installation or adapter test.`),
    );
  });

  it("matches the Claude reference exactly", async () => {
    const claudeReference = await readSkillFile("references/claude-code.md");

    expect(normalize(claudeReference)).toBe(
      normalize(`# Claude Code Mapping

The repository Skill is the source of truth.

For later deployment testing, copy or adapt the workflow into \`.claude/skills/enforced-unlearning/\` and wire the provider adapter for real apply and verify operations.

Do not install during repository tests. Installation is a separate validation step after the package test suite passes.`),
    );
  });

  it("matches openai.yaml exactly", async () => {
    const openaiYaml = await readSkillFile("agents/openai.yaml");

    expect(normalize(openaiYaml)).toBe(
      normalize(`interface:
  display_name: "Enforced Unlearning"
  short_description: "Remove and prevent reintroduction of project agent instructions"
  default_prompt: "Use $enforced-unlearning to plan removal of a project instruction while preserving explicitly retained behavior."`),
    );
  });
});
