# Atelier structured document engine

This independent Rust/WASM crate is a compatibility-gate foundation. It does **not** replace AFFiNE or BlockSuite's live Yjs store, and it is not a completed migration.

Automerge 0.11 stores blocks and canvas properties in nested maps, children and arrays in native lists, and both BlockSuite rich-text marker formats in native text with formatting marks. It never encodes the editable document as one JSON scalar. Snapshot JSON is only an import/export and command boundary. All text offsets use UTF-16 code units.

## Build and verify

Use the repository Rust toolchain and wasm-bindgen CLI 0.2.127:

```sh
cargo test --manifest-path packages/common/atelier-document/Cargo.toml
cargo clippy --manifest-path packages/common/atelier-document/Cargo.toml --all-targets -- -D warnings
cargo build --manifest-path packages/common/atelier-document/Cargo.toml --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir packages/common/atelier-document/pkg packages/common/atelier-document/target/wasm32-unknown-unknown/release/atelier_document.wasm
```

`pkg/atelier_document.js` exports `DocumentEngine` and the default WASM initializer. Build artifacts are ignored. Rust lockfile pins reproducible versions; the crate is isolated from AFFiNE's existing Cargo workspace.

## Browser API

```ts
import init, { DocumentEngine } from './pkg/atelier_document.js';
await init();
const editor = new DocumentEngine('document-id', 'unique-replica-id');
editor.importSnapshot(JSON.stringify(snapshot));
editor.applyCommand(
  JSON.stringify({
    type: 'spliceText',
    path: ['blocks', 'paragraph-id', 'props', 'text'],
    index: 0,
    delete: 0,
    text: 'Hello',
  })
);
const checkpoint = editor.save();
const peer = DocumentEngine.load(checkpoint, 'another-unique-replica-id');
```

Each simultaneously active replica must have its own actor ID; omitting it generates a random ID. `interface.ts` documents the JSON boundary. Commands are `set`, `delete`, `spliceText`, `markText`, `spliceList`, and `batch`. Paths retain exact string IDs, including slashes and numeric-looking map keys. List path segments use numeric indices. Native list edits should use `spliceList`; replacing an entire list with `set` is deliberately a replacement and will not preserve concurrent edits to the previous list.

`markText.value` accepts arbitrary JSON attributes encoded canonically as Automerge mark strings. `null` removes a formatting mark. Browser text positions that split a surrogate pair are rejected. Imports reject unsupported rich-text embeds and unknown delta fields. Core and canvas text-marker identities and nested boxed/map properties survive export; adjacent equivalent text runs can normalize to a single semantic run.

`save`/`load` persist native Automerge checkpoints; `merge` imports another checkpoint for the same document. `heads` returns a JSON array of native change hashes. `generateSyncMessage(peerId)`/`receiveSyncMessage(peerId, bytes)` expose Automerge's per-peer protocol. Peer state stays in memory and can restart safely with a new synchronization handshake. Transport, authentication, access control, PDS persistence and IndexedDB are responsibilities of callers.

## Undo and gate limits

- Text undo removes only locally inserted operation IDs, preserving interleaved remote characters. Replaced text is restored using a stable cursor and its original formatting.
- Field undo checks operation identity and current value before restoring. It refuses conflicting remote field writes or nested edits, rather than overwriting them. Restoring a replaced object includes hidden edits received on the previous object.
- Formatting, deletion, list and batch undo throw explicit unsupported errors and retain an undo barrier. They never clear older history or skip an unsupported action. No redo API exists yet.
- Tree validation requires a present root, reachable blocks, unique child references and matching parent IDs. Atomic `batch` supports block creation/reparenting across intermediate invalid tree states. Conflicting concurrent moves that form cycles or inconsistent trees are explicitly rejected without replacing active state; deterministic repair is not implemented. This prevents claiming the full editor compatibility gate has passed.
- Database UI, real editor transactions/observers/selections, canvas runtime, and full BlockSuite store integration remain required before migrating live editing away from Yjs.

Validation stages imports, commands, checkpoint merges and sync messages before updating active state. Unsupported or conflicting schema versions, mismatched document identities, invalid trees/block shapes and rich-text errors leave the active checkpoint intact. This boundary is not a security sandbox: authenticated peer admission and resource limits belong in the integration layer.
