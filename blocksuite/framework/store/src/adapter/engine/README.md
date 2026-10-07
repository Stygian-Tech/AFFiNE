# Structured document migration boundary

`importBlockSuiteSnapshot` consumes `Transformer.docToSnapshot` output and returns a normalized version 2 document or migration issues. It never returns a partial document. Metadata and arbitrary JSON properties are cloned; block IDs and child order are retained. Canvas `props.elements`, boxed values, text deltas and attributes remain tagged exactly as emitted by BlockSuite's transformers. Text embeds, live Yjs objects, non-finite numbers, cyclic data, and unknown envelope fields fail explicitly.

`exportBlockSuiteSnapshot` reconstructs a document snapshot for migration readback. It rejects invalid parent links, cycles, duplicate child references, and unreachable blocks. This boundary does not migrate asset bytes, collection properties, workspace document ordering, or undo history. The workspace migration coordinator must retain original IndexedDB data and separately copy assets and collection metadata before recording success.

`StructuredCommand` and `WasmDocumentEngine` describe the Rust/WASM command and synchronization API. Positions use UTF-16 code units. The higher-level `DocumentEngine` interface describes the required editor host, including observation, atomic transactions, and redo; the current WASM instance does not yet implement that entire host contract.

These additions do not replace the existing Yjs editor. Substitution requires adapting `Store` transactions, history, direct document access, block sync controllers, `Text.yText`, reactive map proxies, surface element models, and selection anchors. Snapshot mirroring through a hidden Yjs store would not establish an Automerge-native compatibility gate.

Run the deterministic import/readback fixtures through the store Vitest project in `src/__tests__/engine-snapshot.unit.spec.ts`. A complete gate additionally needs real BlockSuite-generated snapshots passed through the WASM engine and restored through the registered block transformers, followed by concurrent native text and canvas edits.
