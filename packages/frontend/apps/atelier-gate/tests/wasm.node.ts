import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AutomergeTextAdapter } from '../../../../../blocksuite/framework/store/src/adapter/engine/automerge-text';
import { exportBlockSuiteSnapshot } from '../../../../../blocksuite/framework/store/src/adapter/engine/snapshot';
import { WasmDocumentHost } from '../../../../../blocksuite/framework/store/src/adapter/engine/wasm-host';
import {
  DocumentEngine,
  initSync,
} from '../../../../common/atelier-document/pkg/atelier_document.js';
import { importedFixture, sourceFixture } from '../src/fixture';

initSync({
  module: readFileSync(
    new URL(
      '../../../../common/atelier-document/pkg/atelier_document_bg.wasm',
      import.meta.url
    )
  ),
});
const seed = new DocumentEngine('atelier-gate', 'seed');
seed.importSnapshot(JSON.stringify(importedFixture()));
assert.deepEqual(
  exportBlockSuiteSnapshot(JSON.parse(seed.snapshot())),
  sourceFixture
);
const path = ['blocks', 'paragraph', 'props', 'text'];
seed.applyCommand(
  JSON.stringify({
    type: 'markText',
    path,
    start: 0,
    end: 5,
    name: 'bold',
    value: true,
  })
);
assert.equal(
  JSON.parse(seed.snapshot()).blocks.paragraph.props.text.delta[0].attributes
    .bold,
  true
);
const a = DocumentEngine.load(seed.save(), 'a');
const b = DocumentEngine.load(seed.save(), 'b');
a.applyCommand(
  JSON.stringify({ type: 'spliceText', path, index: 13, delete: 0, text: ' A' })
);
b.applyCommand(
  JSON.stringify({ type: 'spliceText', path, index: 13, delete: 0, text: ' B' })
);
function synchronize() {
  for (let round = 0; round < 20; round++) {
    const am = a.generateSyncMessage('b');
    const bm = b.generateSyncMessage('a');
    if (!am && !bm) return;
    if (am) b.receiveSyncMessage('a', am);
    if (bm) a.receiveSyncMessage('b', bm);
  }
  throw new Error('Synchronization failed to quiesce');
}
synchronize();
assert.deepEqual(JSON.parse(a.snapshot()), JSON.parse(b.snapshot()));
assert.equal(a.undo(), true);
synchronize();
const document = JSON.parse(a.snapshot());
assert.equal(
  document.blocks.paragraph.props.text.delta
    .map((d: { insert: string }) => d.insert)
    .join(''),
  'Hello Atelier B'
);
b.applyCommand(
  JSON.stringify({
    type: 'set',
    path: ['blocks', 'surface', 'props', 'elements', 'shape', 'xywh'],
    value: '[50,40,100,60]',
  })
);
synchronize();
assert.equal(
  JSON.parse(a.snapshot()).blocks.surface.props.elements.shape.xywh,
  '[50,40,100,60]'
);
const restored = DocumentEngine.load(a.save(), 'restored');
assert.deepEqual(JSON.parse(restored.snapshot()), JSON.parse(a.snapshot()));
assert.deepEqual(
  JSON.parse(restored.snapshot()).blocks.database.props,
  importedFixture().blocks.database.props
);
assert.equal(
  JSON.parse(restored.snapshot()).blocks.attachment.props.sourceId,
  'asset-sha256-original'
);
const beforeInvalid = restored.snapshot();
assert.throws(() =>
  restored.applyCommand(
    JSON.stringify({
      type: 'spliceText',
      path,
      index: 10000,
      delete: 0,
      text: 'invalid',
    })
  )
);
assert.equal(restored.snapshot(), beforeInvalid);
for (const engine of [seed, a, b, restored]) engine.free();

const hostSeed = new DocumentEngine('atelier-gate', 'host-seed');
hostSeed.importSnapshot(JSON.stringify(importedFixture()));
const host = new WasmDocumentHost(hostSeed, DocumentEngine);
const peer = new WasmDocumentHost(
  DocumentEngine.load(host.checkpoint(), 'host-peer'),
  DocumentEngine
);
const text = new AutomergeTextAdapter(host, path);
const peerText = new AutomergeTextAdapter(peer, path);
const events: string[] = [];
const unsubscribe = host.observe(change => events.push(change.origin));
let textEvents = 0;
const unobserveText = text.observe(() => textEvents++);
const anchor = text.createAnchor(5);
text.transact(() => {
  text.insert(0, 'Local ');
  assert.equal(text.toString(), 'Local Hello Atelier');
  text.format(0, 5, { italic: true });
});
assert.deepEqual(events, ['local']);
assert.equal(textEvents, 1);
assert.equal(text.resolveAnchor(anchor), 11);
assert.equal(text.toDelta()[0].attributes?.italic, true);
assert.equal(host.undo(), true);
assert.equal(text.toString(), 'Hello Atelier');
assert.equal(host.redo(), true);
assert.equal(text.toString(), 'Local Hello Atelier');
text.transact(() => {
  text.insert(1, 'x');
  assert.equal(
    text.toDelta().find(span => span.insert.includes('x'))?.attributes?.italic,
    true
  );
});
assert.equal(
  text.toDelta().find(span => span.insert.includes('x'))?.attributes?.italic,
  true
);
assert.equal(host.undo(), true);
text.insert(1, 'y', {});
assert.equal(
  text.toDelta().find(span => span.insert.includes('y'))?.attributes?.italic,
  undefined
);
assert.equal(host.undo(), true);
peerText.insert(0, 'Peer ');
for (let round = 0; round < 20; round++) {
  const am = host.generateSyncMessage('peer');
  const bm = peer.generateSyncMessage('host');
  if (!am && !bm) break;
  if (am) peer.receiveSyncMessage('host', am);
  if (bm) host.receiveSyncMessage('peer', bm);
}
assert.deepEqual(host.read(), peer.read());
assert.ok(events.includes('remote'));
const before = host.checkpoint();
const eventCount = events.length;
assert.throws(() =>
  text.transact(() => {
    text.insert(0, 'should rollback');
    text.delete(10000, 1);
  })
);
assert.deepEqual(host.checkpoint(), before);
assert.equal(events.length, eventCount);
assert.throws(() => {
  host.read().blocks.paragraph.flavour = 'mutated';
});
const wrong = new DocumentEngine('other-document', 'other');
const wrongFixture = importedFixture();
wrongFixture.documentId = 'other-document';
wrongFixture.metadata.id = 'other-document';
wrong.importSnapshot(JSON.stringify(wrongFixture));
assert.throws(() => host.restore(wrong.save()), /another document/);
assert.deepEqual(host.checkpoint(), before);
wrong.free();
unsubscribe();
unobserveText();
host.dispose();
host.dispose();
assert.throws(() => host.read(), /disposed/);
peer.dispose();
console.log(
  'PASS: generated WASM, BlockSuite snapshots, observable host, transactional rich text, native cursor anchors, undo/redo, native sync, canvas and retained database/assets.'
);
