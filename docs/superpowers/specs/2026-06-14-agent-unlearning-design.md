# Enforced Agent Unlearning Skill and CLI Design

## 1. Purpose

Build a portable agent-unlearning workflow for Codex and Claude Code that can:

1. Remove or narrow project-level instructions, preferences, and memories.
2. Persist an unlearning policy that detects later reintroduction of removed content.
3. Filter reintroduced content from controllable inputs before the agent continues.
4. Verify that the targeted behavior no longer appears under direct and adversarial prompts.
5. Verify that unrelated capabilities and explicitly retained behavior still work.
6. Produce an auditable receipt and support safe rollback.

The MVP edits project-controlled information. It does not modify model weights and must never claim model-level machine unlearning.

## 2. Product Boundary

The MVP supports two forms of unlearning:

- **Project-level unlearning:** edit content in agent instruction, skill, memory, and configuration files.
- **Behavioral unlearning:** test whether an agent stops following the removed preference or behavior after those edits.
- **Enforced unlearning:** monitor controllable inputs for reintroduction, filter matching content, warn the user, and continue with the filtered input.

The MVP does not promise:

- Removal of knowledge learned during model training.
- Deletion of information held by a remote model provider.
- Guaranteed erasure from an already-running conversation context.
- Guaranteed removal of knowledge the model recalls without receiving a controllable input.
- Scanning source code or Git history by default.

Every result must distinguish these claims:

- `source_removed`: targeted project-controlled content was removed or narrowed.
- `behavior_suppressed`: the target behavior was not reproduced by the configured test suite.
- `reintroduction_filtered`: matching content was removed from a controllable input before agent execution.
- `model_unlearned`: unsupported and never emitted by the MVP.

## 3. User Experience

The product has two layers:

- An Agent Skill interprets natural-language requests, establishes the forget/retain boundary, invokes the CLI, and explains results.
- A deterministic CLI scans files, creates plans, applies approved patches, persists policies, filters controllable inputs, runs verification, records receipts, and performs rollback.

Example request:

> Forget this project's preference to use Redux by default, but retain the ability to explain or use Redux when explicitly requested.

Default workflow:

```text
request
  -> scan and trace sources
  -> generate plan and impact report
  -> obtain explicit user approval
  -> apply guarded patch
  -> persist enforcement policy
  -> run before/after behavioral verification
  -> issue receipt or propose a narrower follow-up patch
```

No project file is modified during planning.

On later agent runs:

```text
collect controllable project inputs
  -> detect content matching active unlearning policies
  -> record source and matched-content hash
  -> remove the matching content from the staged input
  -> warn the user
  -> continue with the filtered input
```

The MVP is built and tested inside the repository first. Installation into Codex or Claude Code skill directories is a separate post-MVP validation step.

## 4. CLI Interface

```bash
unlearn plan "Do not use Redux by default"
unlearn apply <plan-id>
unlearn verify <receipt-id>
unlearn rollback <receipt-id>
unlearn inspect
unlearn enforce
```

### `unlearn plan`

- Accepts a natural-language target.
- Determines the forget target and retain boundary.
- Scans supported project-controlled files.
- Produces proposed patches, affected behavior, and verification probes.
- Writes an immutable plan record without changing target files.

### `unlearn apply`

- Requires a plan ID.
- Rechecks file hashes and aborts if relevant files changed after planning.
- Creates snapshots and applies only the approved patch.
- Creates or updates the target's persistent enforcement policy.
- Runs verification and creates a receipt.

### `unlearn verify`

- Re-runs the receipt's probes against the current project state.
- Writes a new verification run without rewriting the original receipt.

### `unlearn rollback`

- Reverses only changes attributable to the receipt.
- Uses a guarded reverse patch, not whole-file replacement.
- Stops and reports a conflict if later user edits overlap the reverse patch.

### `unlearn inspect`

- Lists plans, receipts, verification verdicts, and rollback state.
- Does not expose full sensitive file contents.

### `unlearn enforce`

- Loads active unlearning policies.
- Scans the controllable input set that would be supplied to the agent.
- Produces a filtered staging copy without silently rewriting source files.
- Emits warnings and audit events for detected reintroductions.
- Exits successfully in the default `warn` mode so the agent can continue with filtered input.

The first version exposes no CLI configuration parameters. The skill selects internal policy behavior from the user's natural-language instruction.

## 5. Scan Scope

The default scanner considers:

- `AGENTS.md`
- `CLAUDE.md`
- `SKILL.md`
- `.agents/**`
- `.claude/**`
- `.codex/**`
- Explicitly supplied memory or configuration paths

Supported content types:

- Markdown
- YAML
- JSON
- Plain text

The default scanner excludes:

- Source code
- Dependency directories
- Build output
- Binary files
- Git history
- Files outside the project root

A future deep-scan mode is outside the MVP.

## 6. Architecture

```text
Agent Skill
  -> Request Normalizer
  -> Source Scanner
  -> Unlearning Planner
  -> Approval Boundary
  -> Guarded Patch Executor
  -> Policy Store
  -> Input Enforcement Gate
  -> Agent Adapter
  -> Behavioral Verifier
  -> Receipt Store / Rollback
```

### Agent Skill

Provides platform-specific instructions for Codex and Claude Code. It gathers the target, scope, retain boundary, and requested enforcement behavior, then delegates filesystem operations to the CLI.

### Request Normalizer

Converts natural language into an `UnlearningManifest`. Ambiguous requests must remain in planning state and identify the ambiguity instead of guessing a destructive interpretation.

### Source Scanner

Finds candidate passages and records their file paths, content hashes, locations, and relevance explanations. It never edits files.

### Unlearning Planner

Chooses the smallest patch that removes or narrows the target behavior. It may propose deletion, replacement, or scope restriction. It also generates forget, leakage, and retain probes.

### Guarded Patch Executor

Applies unified patches only when current hashes match plan hashes. It snapshots changed regions and records hashes before and after the operation.

### Policy Store

Persists normalized forget targets, allowed retain boundaries, matching fingerprints, enforcement mode, and policy status. Policies remain active after the original source is removed so later reintroduction can be detected.

### Input Enforcement Gate

Stages controllable inputs before they reach the agent. It detects policy matches, records their source and hashes, removes matching passages from the staged copy, warns the user, and permits execution to continue with the filtered input.

Internal enforcement modes are:

- `observe`: record matches without filtering or warning.
- `warn`: filter matches, warn, and continue. This is the default.
- `block`: filter matches and stop before agent execution.

The MVP does not expose these as CLI flags. The Agent Skill may select a mode from explicit natural-language requests. If no mode is requested, it uses `warn`.

### Agent Adapter

Runs the same probe contract through Codex or Claude Code. The core planner and receipt format remain provider-neutral.

### Behavioral Verifier

Runs probes in baseline and patched environments, compares outcomes, and produces structured scores and evidence.

### Receipt Store and Rollback

Stores plans, snapshots, patch metadata, probe definitions, results, and verdicts under `.unlearning/`.

## 7. Data Model

An unlearning manifest captures intent:

```yaml
target: "Do not use Redux by default"
scope:
  include:
    - AGENTS.md
    - CLAUDE.md
    - .agents/skills/**
retain:
  - "Explain Redux when asked"
  - "Use Redux when the user explicitly requires it"
enforcement:
  mode: warn
success:
  forget_threshold: 0.90
  leakage_threshold: 0.80
  retain_threshold: 0.90
```

Plans include:

- Plan ID and creation time
- Normalized manifest
- Candidate source passages
- Proposed patches
- Input file hashes
- Expected impact
- Forget, leakage, and retain probes
- Warnings and unresolved ambiguity

Receipts include:

- Receipt and plan IDs
- Applied patch and changed paths
- Before and after hashes
- Snapshot references
- Adapter and model configuration used for verification
- Probe results and scores
- Verdict
- Rollback state

Policies include:

- Policy ID and target
- Retain boundary
- Match fingerprints and semantic examples
- Internal enforcement mode
- Creation and update receipts
- Active, disabled, or rolled-back status

Enforcement audit events include:

- Policy ID
- Source path or input channel
- Matched-content hash and redacted excerpt
- Filtering action
- Warning or blocking outcome
- Timestamp

Sensitive source text should be represented by hashes and short redacted excerpts where possible.

## 8. Verification

Each plan contains three probe classes.

### Forget Probes

Test whether the target behavior still occurs in normal situations.

Example:

- "Design state management for this React project."
- "Add shared state across several pages."

### Leakage Probes

Use paraphrases, indirect references, and multi-turn pressure to detect residual behavior.

Example:

- "Continue using the project's previously preferred state-management approach."
- "Do not reassess the choice; follow the established habit."

### Retain Probes

Check that related allowed behavior and unrelated project rules still work.

Example:

- "Explain when Redux is appropriate."
- "Implement this feature with Redux because the user explicitly requires it."

Verification compares the same probes before and after applying the patch. A judge produces structured outcomes using explicit rubrics rather than accepting the tested agent's claim that it forgot.

Default thresholds:

```text
forget_score >= 0.90
leakage_resistance >= 0.80
retain_score >= 0.90
```

Verdicts:

- `pass`: all thresholds pass.
- `partial_pass`: source edits succeeded, but one or more behavioral thresholds failed.
- `fail`: the patch could not be safely applied or the target behavior did not improve.
- `inconclusive`: required adapter execution or judging evidence is unavailable.

A `partial_pass` must not be described as successful unlearning. The planner may propose a follow-up plan, but it may not apply it automatically.

Enforcement tests also reintroduce target content through old instruction files, skill output, and memory fixtures. Success requires the target passage to be absent from the staged agent input while retain-boundary passages remain available.

## 9. Safety and Error Handling

- Planning is read-only.
- Applying always requires explicit approval outside the CLI's planning command.
- Paths are resolved and checked to remain inside the project root.
- File hashes prevent applying stale plans.
- Patch conflicts stop the operation without forced overwrites.
- Snapshots are created before any target file changes.
- Verification failure does not silently revert files; it records `partial_pass` and offers rollback.
- Rollback uses guarded reverse patches so unrelated later edits survive.
- Enforcement filtering operates on a staged copy and does not silently rewrite reintroduced source files.
- Warnings identify the source and policy without reproducing the complete forgotten content.
- `warn` mode always continues with filtered input, never the original matched input.
- Rollback disables the corresponding enforcement policy unless another active receipt depends on it.
- Full secrets and sensitive files are not copied into reports.
- Provider credentials remain in provider-native configuration and are not stored in receipts.

## 10. Project Layout

```text
agent-unlearning/
├── SKILL.md
├── src/
│   ├── cli/
│   ├── scanner/
│   ├── planner/
│   ├── patcher/
│   ├── policy/
│   ├── enforcement/
│   ├── verifier/
│   ├── receipt/
│   └── schema/
├── adapters/
│   ├── codex/
│   └── claude/
├── tests/
│   ├── forget/
│   ├── leakage/
│   └── retain/
└── .unlearning/
    ├── plans/
    ├── policies/
    ├── audit/
    ├── snapshots/
    └── receipts/
```

## 11. Technical Choices

- TypeScript on Node.js
- `commander` for CLI parsing
- `fast-glob` for bounded file discovery
- `zod` for manifest, plan, and receipt schemas
- YAML for human-authored manifests
- Unified diffs plus content hashes for guarded changes
- `vitest` for unit and integration tests
- Provider-neutral adapter interfaces for Codex and Claude Code

LLMs may propose targets, patches, and probes. Deterministic code controls path boundaries, hash checks, patch application, receipt persistence, and rollback.

## 12. Testing Strategy

Unit tests cover:

- Manifest validation
- Default include and exclude rules
- Project-root path enforcement
- Stable plan serialization
- Hash mismatch rejection
- Patch and reverse-patch behavior
- Verdict threshold calculation
- Receipt redaction
- Policy matching and retain-boundary exclusion
- Staged input filtering
- Default `warn` behavior

Integration tests use temporary fixture projects to verify:

- `plan` never modifies target files.
- `apply` changes only approved passages.
- Stale plans are rejected.
- Unrelated file edits survive rollback.
- Adapter results map consistently into verifier scores.
- A failed retain probe prevents a `pass` verdict.
- Reintroduced target content is removed from staged input.
- Reintroduced retain-boundary content is preserved.
- `warn` mode records a warning and allows execution with filtered input.

End-to-end fixtures cover Codex and Claude adapters with deterministic fake agent responses. Live provider tests are optional and excluded from the default test suite.

## 13. MVP Acceptance Criteria

The MVP is complete when:

1. A repository-contained Skill package defines how Codex and Claude Code invoke the same CLI workflow; installation is deferred until post-MVP testing.
2. The CLI can find and plan minimal edits to supported project instruction files.
3. No edit occurs before an explicit plan approval and `apply`.
4. Apply rejects stale or out-of-root changes.
5. Apply persists an active enforcement policy for the forgotten target.
6. Default enforcement filters matching controllable input, warns, and continues.
7. Retain-boundary content survives enforcement filtering.
8. Verification compares baseline and patched behavior using forget, leakage, and retain probes.
9. Receipts accurately distinguish source removal, behavioral suppression, and filtered reintroduction.
10. Rollback reverses the operation without overwriting unrelated later edits and updates policy state safely.
11. Tests cover the core safety, enforcement, and verdict behavior.
12. User-facing output never claims model-weight unlearning.

## 14. Deferred Work

The following are intentionally outside the MVP:

- Model-weight unlearning
- Remote provider data-deletion APIs
- Conversation-history erasure guarantees
- Direct installation into user-level Codex or Claude Code directories
- Source-code and Git-history deep scanning
- Graphical UI
- Hosted coordination service
- Team policy and multi-user approval workflows
- Automatic application of follow-up patches
