---
name: create-feature
description: Use when the user asks to take a feature or bug fix from prompt to implementation, especially prompts like "/create a new feature", "build this feature end-to-end", "take this from plan to PR", or "own this change through validation and handoff". This skill is for repo-local delivery workflows that must create and maintain implementation plans, choose the right Rust or web checks, run local validation, and open a PR against main.
---

# Create Feature

Use this skill when one agent should carry a repo change through planning, implementation, validation, and PR handoff.

## What This Skill Owns

- Create and maintain an implementation plan for non-trivial work.
- Inspect the current checkout and make sure it is ready before editing.
- Implement the requested change directly unless a real product decision blocks progress.
- Add or update tests that match the changed behavior.
- Run the smallest set of local validation commands that fully covers the changed surface.
- Open a PR against `main`.

## Required Reads

Before changing code, read the materials that define the current task and touched surface:

1. Any relevant file under `implementation-plans/`
2. `Cargo.toml`
3. `package.json`
4. `apps/web/package.json` when the change may touch the web app
5. `.github/PULL_REQUEST_TEMPLATE.md` when it exists

Read additional feature-local files before editing instead of relying on assumptions.

## Checkout Readiness

Do not create a worktree in this skill.

Instead:

1. Inspect checkout state with non-interactive Git commands.
2. If the repo is already in a Git worktree, make sure the worktree is attached to a branch before opening a PR.
3. Confirm dependencies are available only when the chosen validation commands require them.

Default readiness expectations:

- Use `yarn install --immutable` from the repo root when web validation needs packages.
- Respect the repo's committed Yarn linker settings such as `.yarnrc.yml`. If the repo has no committed linker config, treat that as a repo issue and prefer fixing the repo before blaming the feature change.
- Use `cargo metadata --no-deps` or `cargo check` to confirm Rust tooling is available when Rust crates are in scope.
- Treat Tauri as an extra validation surface only when the change touches `apps/tauri/` or shared Rust code consumed by Tauri.

## Planning Contract

For non-trivial work, derive a concise slug from the task and create `implementation-plans/<slug>.md`.

Use the repo's established plan format:

- `# <Title>`
- `## Goal`
- `## Approach`
- `## Affected Areas`
- `## Checklist`

Keep the checklist current while you work. Mark steps complete only after they are actually done.

Do not create an implementation plan for narrow housekeeping work such as typo-only edits or pure formatting cleanup.

## Execution Contract

After planning, implement directly unless blocked by a material ambiguity.

Always:

- Prefer the smallest change that fully solves the task.
- Read existing patterns before introducing new ones.
- Keep Rust-core, WASM-bridge, web-app, and Tauri responsibilities clearly separated.
- Preserve repo conventions already visible in neighboring files instead of inventing new workflow layers.
- Keep a running summary of what changed and why for the PR body.

## Test Expectations

Choose tests based on the changed behavior:

- Add or update Rust unit or integration tests for changed library or CLI behavior.
- Add or update Vitest coverage for changed web behavior.
- If the change only updates repo process files such as skills, plans, or PR templates, explain why no product tests were needed.

## Validation Commands

Run the smallest set of commands that fully covers the touched area. Do not run unrelated checks just to be exhaustive.

### Repo-process or docs-only changes

No product build is required when only files such as `.agents/`, `.github/`, or `implementation-plans/` change. In that case, validate by checking the changed files for consistency and making sure the workflow instructions reference commands that actually exist in the repo.

### Rust core, CLI, or shared library changes

Run from the repo root:

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
```

### Web app changes under `apps/web/`

Run from the repo root:

```bash
yarn validate:web
```

If the repo does not expose `yarn validate:web`, fall back to:

```bash
yarn workspace web test
yarn build:wasm
yarn workspace web build
```

If the repo exposes an additional lint command and it runs cleanly, include it. Do not assume `yarn lint` exists in every repo.
### WASM bridge changes under `rectify-wasm/` or web/WASM integration

Run from the repo root:

```bash
yarn build:wasm
```

### Tauri desktop changes under `apps/tauri/` or shared Rust used by Tauri

Run from the repo root:

```bash
cargo check -p pattern-detector-tauri
```

In your final summary and PR notes, report:

- Which validations ran
- Which validations were skipped
- Why each skipped validation was unnecessary

## Pull Request Handoff

Unless the user asked otherwise, open a PR against `main`.

Before creating the PR:

1. Confirm the working tree contains only intended changes.
2. Fill the PR body using `.github/PULL_REQUEST_TEMPLATE.md` when present, otherwise synthesize the same sections yourself.
3. Include the implementation plan path in the PR notes when one was created.
4. Summarize tests added, validations run, and intentionally skipped checks.

Use `gh pr create --base main`.

If GitHub auth or remote access is unavailable, stop after local validation and report the exact blocker.

## Preview Expectations

Do not promise a preview deployment in this repo unless you can confirm a real preview workflow exists for the opened PR.

If no preview workflow exists, explicitly say so in the handoff instead of implying one should appear later.

## Guardrails

- Do not create or switch worktrees from this skill.
- Do not skip the implementation plan for non-trivial work.
- Do not open the PR before the required local validation for the touched area succeeds.
- Do not target a base branch other than `main` unless the user explicitly says so.
- If the skill's own assumptions conflict with the repo's checked-in reality, update the repo-local workflow files or the skill itself when the user asks so future agents inherit the fix.
