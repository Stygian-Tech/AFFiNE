import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  exportBlockSuiteSnapshot,
  importBlockSuiteSnapshot,
} from '../adapter/engine/snapshot';

function fixture() {
  return {
    type: 'page',
    meta: {
      id: 'doc:日本語',
      title: 'Canvas and text',
      createDate: 12,
      tags: ['one'],
      updatedDate: 22,
      favorite: true,
      trash: false,
    },
    blocks: {
      type: 'block',
      id: '__proto__',
      flavour: 'affine:page',
      version: 2,
      props: { title: { '$blocksuite:internal:text$': true, delta: [] } },
      children: [
        {
          type: 'block',
          id: 'paragraph',
          flavour: 'affine:paragraph',
          props: {
            text: {
              '$blocksuite:internal:text$': true,
              delta: [
                {
                  insert: 'Hello 👩🏾‍💻',
                  attributes: { bold: true, link: 'https://example.com' },
                },
                { insert: '\n' },
              ],
            },
            custom: {
              '$blocksuite:internal:native$': true,
              value: { nested: [1, null, false] },
            },
          },
          children: [],
        },
        {
          type: 'block',
          id: 'surface',
          flavour: 'affine:surface',
          version: 1,
          props: {
            elements: {
              'shape:1': {
                id: 'shape:1',
                type: 'shape',
                xywh: '[0,0,100,80]',
                index: 'a0',
              },
              'connector:1': {
                type: 'connector',
                source: { id: 'shape:1' },
                target: { position: [30, 40] },
              },
              'text:1': {
                type: 'text',
                text: {
                  'affine:surface:text': true,
                  delta: [{ insert: 'Label', attributes: { color: '#000' } }],
                },
                cells: {
                  'affine:surface:ymap': true,
                  json: { foo: { arbitrary: 'property' } },
                },
              },
            },
          },
          children: [],
        },
        {
          type: 'block',
          id: 'database',
          flavour: 'affine:database',
          props: {
            columns: [{ id: 'column', type: 'rich-text' }],
            cells: { paragraph: { column: 'value' } },
          },
          children: [],
        },
        {
          type: 'block',
          id: 'attachment',
          flavour: 'affine:attachment',
          props: {
            sourceId: 'asset-content-hash',
            name: 'file.pdf',
            size: 1024,
          },
          children: [],
        },
      ],
    },
  };
}

test('imports and reads back rich text, metadata, canvas, database and attachment references exactly', () => {
  const source = fixture();
  const result = importBlockSuiteSnapshot(source);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.document.rootId, '__proto__');
  assert.equal(result.document.blocks.paragraph.parentId, '__proto__');
  assert.deepEqual(
    result.document.blocks.__proto__.children,
    source.blocks.children.map(block => block.id)
  );
  assert.deepEqual(exportBlockSuiteSnapshot(result.document), source);
  result.document.blocks.paragraph.props.custom = null;
  assert.notEqual(source.blocks.children[0].props.custom, null);
});

test('rejects duplicate ids rather than overwriting blocks', () => {
  const source = fixture();
  source.blocks.children[1].id = 'paragraph';
  const result = importBlockSuiteSnapshot(source);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(result.issues.some(issue => issue.reason.includes('Duplicate')));
});

test('reports unsupported embeds and all non-JSON values without partial migration', () => {
  const source = fixture();
  Object.assign(source.blocks.props, {
    embed: {
      '$blocksuite:internal:text$': true,
      delta: [{ insert: { mention: 'did:plc:alice' } }],
    },
    undefinedField: undefined,
    invalidNumber: Infinity,
    nonPlain: new Date(),
  });
  const result = importBlockSuiteSnapshot(source);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues.length, 4);
    assert.ok(
      result.issues.some(
        issue => issue.path === '$.blocks.props.embed.delta[0]'
      )
    );
  }
});

test('reports unknown envelope fields rather than discarding them', () => {
  const source = fixture();
  Object.assign(source.blocks, { unknown: true });
  const result = importBlockSuiteSnapshot(source);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues[0].path, '$.blocks.unknown');
});

test('rejects cyclic objects and sparse arrays', () => {
  const source = fixture();
  const sparse: unknown[] = [];
  sparse.length = 2;
  Object.assign(source.blocks.props, {
    loop: source.blocks.props,
    sparse,
  });
  const result = importBlockSuiteSnapshot(source);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(result.issues.some(issue => issue.reason.includes('Cyclic')));
});

test('rejects malformed markers and malformed metadata', () => {
  const source = fixture();
  Object.assign(source.meta, { tags: [12] });
  Object.assign(source.blocks.props, {
    bad: { 'affine:surface:text': false, delta: [] },
  });
  const result = importBlockSuiteSnapshot(source);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(
      result.issues.some(issue => issue.reason.includes('tagged rich text'))
    );
  delete (source.blocks.props as Record<string, unknown>).bad;
  assert.equal(importBlockSuiteSnapshot(source).ok, false);
});

test('rejects accessors without invoking getters anywhere in the snapshot', () => {
  for (const select of [
    (source: ReturnType<typeof fixture>) => source,
    (source: ReturnType<typeof fixture>) => source.meta,
    (source: ReturnType<typeof fixture>) => source.blocks,
    (source: ReturnType<typeof fixture>) => source.blocks.props,
  ]) {
    const source = fixture();
    Object.defineProperty(select(source), 'getter', {
      enumerable: true,
      get() {
        throw new Error('Getter must not run');
      },
    });
    const result = importBlockSuiteSnapshot(source);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(result.issues.some(issue => issue.reason.includes('accessor')));
  }
});

test('readback rejects unreachable blocks and invalid parent references', () => {
  const result = importBlockSuiteSnapshot(fixture());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  result.document.blocks.paragraph.parentId = null;
  assert.throws(
    () => exportBlockSuiteSnapshot(result.document),
    /Invalid materialized/
  );
  result.document.blocks.paragraph.parentId = '__proto__';
  result.document.blocks.orphan = {
    id: 'orphan',
    parentId: null,
    flavour: 'x',
    props: {},
    children: [],
  };
  assert.throws(() => exportBlockSuiteSnapshot(result.document), /Unreachable/);
});
