# Source provenance

The candidate preserves AFFiNE and BlockSuite in this fork. Existing license
notices remain intact.

Atelier was inspected at local revision
`fbc0d825e998ffe2226803d4d75d24dcb29984e8`, from
`https://github.com/Stygian-Tech/atelier`:

- `packages/rust/atelier-sync-protocol`: Automerge checkpoint, per-peer sync,
  admission, role, and durability conventions.
- `packages/rust/atelier-sync-transport`: ordered iroh transport framing.
- `packages/lexicons`: public-PDS disclosure, `diy.atelier.*` namespace, Notes
  records, and checkpoint references.

The structured document engine added here is new code. Atelier's Markdown-only
document model and V1 wire protocol are not claimed to support BlockSuite
structured documents. The model harness does not use the transport or PDS
implementations, which remain dependent on the editor compatibility gate.

Dependencies are pinned in the new crate's Cargo.lock. Automerge rich text and
maps/lists encode editable state natively; tagged BlockSuite rich-text attributes
are encoded as JSON mark values to retain arbitrary inline metadata.

References:

- https://automerge.org/docs/reference/documents/rich-text/
- https://docs.iroh.computer/languages/wasm-browser
