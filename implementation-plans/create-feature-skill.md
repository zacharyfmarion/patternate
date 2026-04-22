# Create Feature Skill Adaptation

## Goal

Adapt the repo-local `create-feature` skill from `openscad-studio` and `cascade` so it fits `pattern-detector`'s actual workflows, then use that workflow to ship the change as a pull request against `main`.

## Approach

1. Review the source `create-feature` skills and extract the reusable planning, validation, and PR handoff structure.
2. Tailor the skill to this repo's actual layout and commands across Rust, web, WASM, and Tauri.
3. Add the smallest missing support files needed for the workflow here, especially a PR template.
4. Validate the change with the checks appropriate for repo-process documentation updates.
5. Commit, push, and open a PR against `main`.

## Affected Areas

- `.agents/skills/create-feature/`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `implementation-plans/create-feature-skill.md`

## Checklist

- [x] Inspect the source `create-feature` skills and this repo's workflow surface
- [x] Add the adapted repo-local `create-feature` skill and metadata
- [x] Add a PR template that matches the skill handoff flow
- [x] Run validation appropriate for this change
- [x] Commit, push, and open a PR against `main`
