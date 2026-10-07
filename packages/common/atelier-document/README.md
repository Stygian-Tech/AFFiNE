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
- `redo()` writes selective inverse operations for text, map fields, map deletion, native list splices, and formatting. A new local command clears redo history; remote synchronization preserves it. Formatting restores only the original character identities, leaving peer inserts alone. Because Automerge exposes mark values without winning operation identities, a later peer write of the same mark name on the same text refuses undo/redo, including equal-value peer writes.
- `batch` undo/redo is atomic when every child command supports it. Native list inverses remove only original inserted identities and refuse nested peer changes. Direct numeric-path `delete` on a list remains an explicit unsupported barrier; editor list editing uses `spliceList`. Map deletion restores only if the field is still absent and no later peer operation touched that key, including a peer write followed by deletion. History never skips an unsupported or conflicting action.
- `getCursor(pathJson, index)` and `resolveCursor(pathJson, cursor)` expose native Automerge cursors with UTF-16 offsets. Invalid ranges, surrogate boundaries and malformed cursors are rejected. Automerge 0.11 has a debug-only fast/slow cursor assertion disagreement on a deleted trailing character; this crate disables debug assertions only for that dependency, matching its production release behavior. A regression test covers the returned position after deletion; engine assertions remain enabled.
- `moveBlock { blockId, parentId, index }` changes placement atomically; the index addresses the target's projected children after removing the moving block. Parent registers own placement and native children lists provide ordering hints. Snapshots filter duplicate/obsolete hints and append missing children sorted by ID. Concurrent cycles reparent their smallest block ID to the root in the materialized projection, without generating repair writes. Imports remain strict. Local cycles, root moves and generic structural replacement/deletion reject. Move undo/redo uses selective field/list inverses. Block deletion/restoration and BlockSuite flavour-aware fallback remain pending; a valid graph alone does not establish editor schema compatibility.
- Database UI, real editor transactions/observers/selections, canvas runtime, and full BlockSuite store integration remain required before migrating live editing away from Yjs.

Validation stages imports, commands, checkpoint merges and sync messages before updating active state. Unsupported or conflicting schema versions, mismatched document identities, invalid trees/block shapes and rich-text errors leave the active checkpoint intact. This boundary is not a security sandbox: authenticated peer admission and resource limits belong in the integration layer.

### Pinned dependency cursor regression

`examples/cursor_repro.rs` reproduces the Automerge 0.11 debug assertion without using the Atelier engine: create native text `Hello`, anchor at index 4, delete the last character, then resolve the cursor. Both movement modes hit `op_set2/op_set.rs:846` when dependency debug assertions are enabled. Production behavior correctly resolves `After` to 4 and `Before` to 3.

```sh
# Intentionally reproduces the pinned dependency panic.
cargo --config 'profile.dev.package.automerge.debug-assertions=true' run --manifest-path packages/common/atelier-document/Cargo.toml --example cursor_repro
cargo --config 'profile.dev.package.automerge.debug-assertions=true' run --manifest-path packages/common/atelier-document/Cargo.toml --example cursor_repro -- before
# Confirms production native cursor behavior; assertions in the example check offsets.
cargo run --manifest-path packages/common/atelier-document/Cargo.toml --release --example cursor_repro
cargo run --manifest-path packages/common/atelier-document/Cargo.toml --release --example cursor_repro -- before
```
