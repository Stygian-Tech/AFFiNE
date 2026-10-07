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
Candidate issue: [ATE-24](https://linear.app/stygian-tech/issue/ATE-24/build-affine-web-candidate-with-automerge-atproto-pds-and-iroh), In Progress.

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
  validation, selective undo/redo, native cursor anchors and deterministic move
  projection. Thirty-seven native tests pass with the
  repository's Rust 1.97.1 toolchain; Clippy and formatting checks pass.
- Generated Rust/WASM bindings exercised directly in Node against the
  BlockSuite-shaped fixture: import/readback, concurrent text, formatting,
  canvas leaf edits, selective undo, native sync, checkpoint restoration, and
  database/attachment property retention pass.
- An observable WASM host and path-bound rich-text adapter with atomic grouped
  edits and native cursor anchors. Readback is immutable and observers receive
  committed local/remote changes. Restoration rejects another document identity.
- The actual BlockSuite InlineEditor now accepts the text adapter, with its
  built-in editing/rendering/selection services using the neutral boundary.
  Existing Yjs callers retain their original backend. All 31 existing and new
  inline regression tests pass.
- A React workbench mounts that actual InlineEditor against independent native
  replicas, with local IndexedDB checkpoints and explicit compatibility status.
  Its TypeScript check and Vite production build pass.
- Reproducible `yarn atelier:build:wasm`, `yarn atelier:gate`, and
  `yarn atelier:test` commands. A fork-only CI workflow runs native, WASM, and
  browser model checks. CI success would still not pass the live editor gate.

## Compatibility gate result: not passed

The workbench mounts the actual BlockSuite inline text editor over Automerge.
The complete page/canvas editor still requires a native live `Store`, reactive
proxies, canvas observers and workspace history integration. The SVG canvas
remains a model display, rather than the original canvas editor.

Concrete engine limits also fail the required gate:

- Text, formatting, map field/deletion, list splice and grouped command history
  is selective and supports redo. Direct numeric-path list deletion and history
  exclusion remain unsupported. Formatting conservatively refuses a later peer
  write of the same mark name on the same text rather than overwriting it.
- Dedicated block moves converge through parent ownership and deterministic
  projected ordering/cycle repair. Deletion/restoration semantics and
  BlockSuite flavour-aware cycle fallback remain pending.
- Existing container replacement is an explicit replacement, not a field
  merge. The future editor host must issue granular field/list operations;
  replacing a container can hide concurrent edits to the previous object.
- The current observable host materializes a complete snapshot after changes;
  granular patch observations and stable full-editor model wrappers remain pending.
- Full workspace metadata and asset-byte migration, full page/canvas fidelity,
  IME/clipboard behavior, and performance comparison remain unverified.
- Pinned Automerge 0.11 has a reproduced debug cursor assertion defect on a
  deleted trailing character. A dependency-only development profile uses its
  verified production cursor behavior; the engine's assertions stay enabled.

The dependent OAuth, PDS persistence, and live iroh integration have not been
implemented. The existing AFFiNE web app continues using its original Yjs
editor and cloud integrations.

## Validation limits in this session

The full existing test command was attempted: 1,511 tests passed, 19 failed,
and four skipped. Failures include missing Electron/native bindings. Earlier
browser launch attempts were blocked by process sandbox permissions. With
authorized process access, ten local Chromium/WebKit checks now pass: native
fixture rendering, actual InlineEditor keyboard input, peer updates, undo/redo
including keyboard shortcuts, emoji/multiline insertion and deletion, IndexedDB
save/reload, retained structured data and mobile layout. Local Firefox
stalled at launch and was interrupted; fork CI covers all three browsers.

The original storage-sync tests (15) and focused BlockSuite block/document/
transformer tests (16) pass. New import tests (8), inline tests (31), native engine
tests (37), generated-WASM host/text integration, and workbench typecheck/build pass.

Full monorepo typecheck fails on ungenerated Prisma and other existing project
dependencies. The original web build fails on absent template assets and other
existing build inputs. Full lint also reports two existing backend test sort
comparators. Those unrelated sources have not been changed; lint and formatting
for the new code pass.

Earlier Linear issue creation was blocked by the prior session approval policy;
ATE-24 now records this work. ATE-6 has not been marked complete or changed.
