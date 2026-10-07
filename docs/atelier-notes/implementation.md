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
