# Atelier Notes web candidate

This work belongs to `Stygian-Tech/AFFiNE`, on
`feature/atelier-notes-atproto`. Never push to or open pull requests against
`toeverything/AFFiNE`.

## Approved architecture

- Keep React, TypeScript, BlockSuite's block/canvas UI, and local-first editing.
- Migrate authoritative structured document state from Yjs to Automerge.
- Use a Rust document engine with browser WASM bindings and browser-owned iroh
  endpoints. Managed relays carry encrypted packets; no document gateway.
- Authenticate with AT Protocol OAuth. Documents and attachments on PDSs are
  public. Each editor persists contributor checkpoints on their own PDS; the
  owner materializes the canonical document.
- Build a standalone candidate, without replacing Atelier's current Notes app.

## Compatibility gate

The editor migration is a prerequisite for OAuth, PDS persistence, and live
iroh integration. A model-only convergence test does not pass this gate.

Required evidence:

1. Existing BlockSuite page and canvas views edit Automerge-backed state without
   a live Y.Doc mirror.
2. Concurrent rich-text edits and formatting, block insertion/movement, canvas
   geometry/connectors/groups, and database properties converge.
3. Local undo preserves remote edits; cursor/IME/emoji/clipboard behavior works.
4. Import and save/reload preserve IDs, rich-text attributes, nested properties,
   attachment references, workspace metadata, and all canvas element types.
5. Changes update models granularly, with measured latency against the existing
   editor baseline.
6. Two independent browser contexts synchronize and survive reconnect.

If any required evidence is missing, the gate stays open and dependent product
integration must not be presented as usable or complete.

## Tracking

Related project: Atelier Full MVP. Related issue:
[ATE-6](https://linear.app/stygian-tech/issue/ATE-6/deliver-atelier-notes-local-first-collaboration-mvp).
Creating the candidate issue was blocked by the session approval policy. Until
Linear writes are available, this document records progress and remaining work.

## Starting point

The original checkout was clean on `canary`. Its `.git` directory is read-only
in this session, so development uses `/private/tmp/affine-atelier-notes` with
`origin` set exclusively to `https://github.com/Stygian-Tech/AFFiNE.git`.

Atelier's current local sources provide a Markdown-specific Automerge engine,
native iroh framing, and lexicon conventions. They do not provide implemented
browser transport, OAuth sessions, or PDS document persistence. Any reused code
must identify its source revision and retain its license.

## Implemented waypoint

- Lossless BlockSuite document snapshot normalization and readback, exported as
  `@blocksuite/store/engine`, with eight deterministic tests. Invalid snapshots
  fail with migration issues rather than returning partially converted data.
- A pinned Rust Automerge engine with real nested maps/lists/text, marked rich
  text, atomic commands, checkpoint loading, per-peer sync, identity/tree
  validation, and supported selective undo. Eighteen native tests pass with the
  repository's Rust 1.97.1 toolchain; Clippy and formatting checks pass.
- Generated Rust/WASM bindings exercised directly in Node against the
  BlockSuite-shaped fixture: import/readback, concurrent text, formatting,
  canvas leaf edits, selective undo, native sync, checkpoint restoration, and
  database/attachment property retention pass.
- A React model workbench with local IndexedDB checkpoints and explicit
  compatibility status. Its TypeScript check and Vite production build pass.
- Reproducible `yarn atelier:build:wasm`, `yarn atelier:gate`, and
  `yarn atelier:test` commands. A fork-only CI workflow runs native, WASM, and
  browser model checks. CI success would still not pass the live editor gate.

## Compatibility gate result: not passed

The new engine is not attached to BlockSuite's existing live `Store`, inline
editor, reactive proxies, canvas observers, selections, or history manager.
The workbench renders model state; it does not stand in for those components.

Concrete engine limits also fail the required gate:

- Formatting, deletion, list, and batch undo are unsupported and produce
  explicit errors without consuming the history barrier. Redo is absent.
- Divergent block moves can create an invalid tree; their checkpoint merge is
  rejected atomically. Deterministic tree-conflict projection/repair remains
  unimplemented.
- Existing container replacement is an explicit replacement, not a field
  merge. The future editor host must issue granular field/list operations;
  replacing a container can hide concurrent edits to the previous object.
- Full workspace metadata and asset-byte migration, existing-editor fidelity,
  IME/cursor/clipboard behavior, and performance comparison remain unverified.

The dependent OAuth, PDS persistence, and live iroh integration have not been
implemented. The existing AFFiNE web app continues using its original Yjs
editor and cloud integrations.

## Validation limits in this session

The full existing test command was attempted: 1,511 tests passed, 19 failed,
and four skipped. Failures include missing Electron/native bindings; browser
suites cannot launch in the restricted macOS process environment. Chromium
fails Mach-port bootstrap permission checks, WebKit aborts, and the alternate
browser-control path could not acquire a working tab. No rendered-browser or
IndexedDB interaction acceptance is claimed.

The original storage-sync tests (15) and focused BlockSuite block/document/
transformer tests (16) pass. New import tests (8), native engine tests (18),
generated-WASM integration, and workbench typecheck/build pass.

Full monorepo typecheck fails on ungenerated Prisma and other existing project
dependencies. The original web build fails on absent template assets and other
existing build inputs. Full lint also reports two existing backend test sort
comparators. Those unrelated sources have not been changed; lint and formatting
for the new code pass.

Linear issue creation was rejected because the session cannot approve connector
writes. The findings and remaining work are retained here for a later Linear
update; ATE-6 has not been marked complete or changed.
