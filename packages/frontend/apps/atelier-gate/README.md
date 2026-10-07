# Structured document compatibility harness

This React 19 web workbench mounts the **actual BlockSuite InlineEditor** against an Automerge text adapter and authoritative Rust/WASM document host. It exercises two independent replicas, native text editing and formatting, canvas model changes, selective undo/redo, Automerge sync messages, and IndexedDB checkpoint restoration. Peer exchange is explicit in-process protocol exchange. It is not iroh transport or the full AFFiNE editor.

The full BlockSuite editor gate is **NOT PASSED**. These concrete interfaces currently prevent substituting this engine:

- `blocksuite/framework/store/src/extension/workspace/doc.ts` exposes `Y.Doc` and `Y.Map<YBlock>` directly.
- `blocksuite/framework/store/src/reactive/text/text.ts` stores `Y.Text` and exposes it through `yText`.
- `blocksuite/framework/store/src/extension/history/history-extension.ts` constructs `Y.UndoManager` from document Yjs state.
- `packages/frontend/core/src/blocksuite/block-suite-editor/blocksuite-editor.tsx` accepts a concrete BlockSuite `Store`, not an engine-neutral document.

The inline editor uses BlockSuite's real rendering, input, selection, and event services; it does not maintain a live Yjs mirror. The SVG remains a model preview, not BlockSuite's canvas editor. Full block/database/canvas fidelity, clipboard/IME, remote selection, and original Store integration remain pending. Login, PDS persistence, and iroh integration remain gated by that compatibility work.

## Run

First build the WASM package using `packages/common/atelier-document` instructions. From this package use `yarn dev`, `yarn build`, `yarn test:wasm`, and `yarn test`. Browser tests require a Playwright Chromium installation. `test:wasm` validates the generated web WASM bindings and real importer in Node, independently of browser launch availability. The frontend uses the generated WASM bindings directly; missing bindings fail the build rather than substituting a JavaScript engine.

## Fixture coverage

The fixture follows BlockSuite's public `DocSnapshot` and nested `BlockSnapshot` shapes from `blocksuite/framework/store/src/transformer/type.ts` and preserves:

| Data                                        | Model coverage                     | Actual editor coverage                          |
| ------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| Page/note/paragraph identities and children | Import, checkpoint, merge          | Pending                                         |
| Delta rich text and bold mark               | Native text edit and mark          | Real InlineEditor mounted; browser input suites |
| Surface shape/connector properties          | Nested property edits              | Pending                                         |
| Database columns, cells, views              | Snapshot retention                 | Pending                                         |
| Image attachment references                 | Snapshot retention                 | Pending                                         |
| Selective undo/redo                         | Local operation after remote merge | Workbench controls; full Store history pending  |

The browser tests assert persisted state and rendered values; they do not declare the full editor compatibility gate passed.
