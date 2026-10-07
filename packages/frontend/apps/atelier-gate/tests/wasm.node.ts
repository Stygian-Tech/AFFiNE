import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { exportBlockSuiteSnapshot } from '../../../../../blocksuite/framework/store/src/adapter/engine/snapshot';
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
console.log(
  'PASS: generated WASM + real BlockSuite import/export fixture, native sync, concurrent edits, selective undo, canvas and retained database/assets. Browser UI remains unverified.'
);
