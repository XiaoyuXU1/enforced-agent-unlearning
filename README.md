# Enforced Agent Unlearning

Repository-contained Codex/Claude skill package for project-level agent unlearning.

This project removes approved instruction or memory text from supported project files, persists an enforcement policy, filters later reintroduced content from staged inputs, verifies behavior with before/after probes through an agent adapter, and supports guarded rollback.

It does not claim model-weight unlearning. It controls project files and staged agent inputs only.

## What Is Included

- `skills/enforced-unlearning/SKILL.md`: the Codex skill package.
- `src/`: provider-neutral TypeScript implementation.
- `dist/`: build output after `npm run build`.
- `.unlearning/`: generated at runtime for plans, receipts, policies, audit logs, and snapshots.

## Supported Scan Targets

The scanner only reads supported project-controlled text/config files:

- `AGENTS.md`
- `CLAUDE.md`
- `SKILL.md`
- `.agents/**/*.md|yaml|yml|json|txt`
- `.claude/**/*.md|yaml|yml|json|txt`
- `.codex/**/*.md|yaml|yml|json|txt`
- explicit include globs are still filtered to `.md`, `.yaml`, `.yml`, `.json`, and `.txt`

## Install Dependencies

```bash
npm install
npm run build
```

## Basic Use

Create a plan:

```bash
node dist/src/cli.js plan "Always use Redux." "Use Redux only when explicitly requested."
```

Review the generated plan under `.unlearning/plans/`.

Apply requires a configured provider adapter. Without one, CLI `apply` and `verify` return `inconclusive` and do not claim success:

```bash
node dist/src/cli.js apply <plan-id>
node dist/src/cli.js verify <receipt-id>
```

Filter reintroduced content through active policies:

```bash
printf "Always use Redux.\nKeep changes scoped.\n" | node dist/src/cli.js enforce
```

Inspect runtime records:

```bash
node dist/src/cli.js inspect
```

Rollback an applied receipt:

```bash
node dist/src/cli.js rollback <receipt-id>
```

## Skill Prompt Pattern

Use a precise forget target and retain boundary:

```text
Use enforced-unlearning.
Forget target: Always use Redux for shared state.
Retain boundary: Use Redux only when I explicitly ask for Redux.
Scope: current project.
Mode: warn, filter, and continue.
```

## Verification

```bash
npm test
npm run typecheck
npm run build
python C:\Users\11153\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills/enforced-unlearning
npm audit --audit-level=high
```

Current branch verification:

- `npm test`: 89 passed, 5 skipped
- `npm run typecheck`: passed
- `npm run build`: passed
- skill validation: passed
- `npm audit --audit-level=high`: 0 vulnerabilities
