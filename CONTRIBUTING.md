# Contributing

## Development Setup

- Install web dependencies from the repo root with `yarn install --immutable`.
- This repo is configured for Yarn `node-modules` installs via [`.yarnrc.yml`](/Users/zacharymarion/.codex/worktrees/1bab/pattern-detector/.yarnrc.yml).
- Rust tooling can be checked with `cargo metadata --no-deps`.

## Common Validation Commands

### Web changes under `apps/web/`

```bash
yarn validate:web
```

If you need the lower-level sequence, use:

```bash
yarn workspace web test
yarn build:wasm
yarn workspace web build
```

### Rust core, CLI, or shared crates

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
```

### WASM bridge changes

```bash
yarn build:wasm
```

### Tauri changes

```bash
cargo check -p pattern-detector-tauri
```

## Pull Requests

- Use `.github/PULL_REQUEST_TEMPLATE.md` for PR summaries.
- Include the implementation plan path when a non-trivial change used one.
