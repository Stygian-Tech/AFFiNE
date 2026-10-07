# Structured document compatibility harness

This React 19 web harness loads the real Rust/WASM document engine. It exercises two independent Automerge replicas, rich text and canvas model changes, selective undo, convergence, and IndexedDB checkpoint restoration. Peer exchange is explicit in-process checkpoint transfer. It is not iroh transport or a production editor.

The full BlockSuite editor gate is **NOT PASSED**. These concrete interfaces currently prevent substituting this engine:

- `blocksuite/framework/store/src/extension/workspace/doc.ts` exposes `Y.Doc` and `Y.Map<YBlock>` directly.
- `blocksuite/framework/store/src/reactive/text/text.ts` stores `Y.Text` and exposes it through `yText`.
- `blocksuite/framework/store/src/extension/history/history-extension.ts` constructs `Y.UndoManager` from document Yjs state.
- `packages/frontend/core/src/blocksuite/block-suite-editor/blocksuite-editor.tsx` accepts a concrete BlockSuite `Store`, not an engine-neutral document.

Rendering this harness's rich text and SVG does not prove AFFiNE editor fidelity, input handling, database editing, canvas tools, remote selections, or live editor undo. Login, PDS persistence, and iroh integration remain gated by that compatibility work.

## Run

First build the WASM package using `packages/common/atelier-document` instructions. From this package use `yarn dev`, `yarn build`, `yarn test:wasm`, and `yarn test`. Browser tests require a Playwright Chromium installation. `test:wasm` validates the generated web WASM bindings and real importer in Node, independently of browser launch availability. The frontend uses the generated WASM bindings directly; missing bindings fail the build rather than substituting a JavaScript engine.

## Fixture coverage

The fixture follows BlockSuite's public `DocSnapshot` and nested `BlockSnapshot` shapes from `blocksuite/framework/store/src/transformer/type.ts` and preserves:

| Data                                        | Model coverage                     | Actual editor coverage |
| ------------------------------------------- | ---------------------------------- | ---------------------- |
| Page/note/paragraph identities and children | Import, checkpoint, merge          | Pending                |
| Delta rich text and bold mark               | Native text edit and mark          | Pending                |
| Surface shape/connector properties          | Nested property edits              | Pending                |
| Database columns, cells, views              | Snapshot retention                 | Pending                |
| Image attachment references                 | Snapshot retention                 | Pending                |
| Selective undo                              | Local operation after remote merge | Pending                |

The browser tests assert persisted state and rendered values; they do not declare the full editor compatibility gate passed.
