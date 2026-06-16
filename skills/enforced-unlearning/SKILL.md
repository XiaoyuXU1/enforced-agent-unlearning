---
name: enforced-unlearning
description: Plan, apply, verify, enforce, inspect, or roll back project-level agent unlearning. Use when a user asks Codex or Claude Code to forget an instruction, preference, memory, or behavior while preserving an explicit retain boundary.
---

# Enforced Unlearning

Use the repository's `unlearn` CLI for deterministic filesystem operations.

## Workflow

1. Restate the exact forget target. If the user provides a retain boundary, restate it too.
2. Run `unlearn plan "<target>"`. If retain boundaries are provided, append them as positional arguments.
3. Show the affected files, proposed removals, retain boundary if provided, and probes.
4. Never run `unlearn apply` before explicit approval.
5. After approval, apply the plan through the configured agent adapter.
6. Report source removal, behavioral verification, and enforcement separately.
7. Default to warn, filter, and continue when forgotten content reappears.
8. Offer rollback when verification is partial or failed.

If no provider adapter is configured, `unlearn apply` and `unlearn verify` return `inconclusive` without claiming success.

Never claim model-weight unlearning. State that the Skill controls project files and staged agent inputs only.

Read `references/claude-code.md` only when preparing a later Claude Code installation or adapter test.
