import { importBlockSuiteSnapshot } from '../../../../../blocksuite/framework/store/src/adapter/engine/snapshot';

export const sourceFixture = {
  type: 'page',
  meta: {
    id: 'atelier-gate',
    title: 'Structured document gate',
    createDate: 1,
    tags: ['gate'],
  },
  blocks: {
    type: 'block',
    id: 'page',
    flavour: 'affine:page',
    version: 2,
    props: {},
    children: [
      {
        type: 'block',
        id: 'note',
        flavour: 'affine:note',
        version: 1,
        props: { xywh: '[0,0,400,200]' },
        children: [
          {
            type: 'block',
            id: 'paragraph',
            flavour: 'affine:paragraph',
            version: 1,
            props: {
              type: 'text',
              text: {
                '$blocksuite:internal:text$': true,
                delta: [{ insert: 'Hello Atelier' }],
              },
            },
            children: [],
          },
        ],
      },
      {
        type: 'block',
        id: 'surface',
        flavour: 'affine:surface',
        version: 1,
        props: {
          elements: {
            shape: {
              id: 'shape',
              type: 'shape',
              xywh: '[30,40,100,60]',
              index: 'a0',
              fillColor: '#dce9ff',
            },
            connector: {
              id: 'connector',
              type: 'connector',
              source: { id: 'shape' },
              target: { position: [240, 70] },
              index: 'a1',
            },
          },
        },
        children: [],
      },
      {
        type: 'block',
        id: 'database',
        flavour: 'affine:database',
        version: 1,
        props: {
          columns: [{ id: 'title', type: 'rich-text', name: 'Title' }],
          cells: { paragraph: { title: 'Preserved' } },
          views: [{ id: 'table', mode: 'table' }],
        },
        children: [],
      },
      {
        type: 'block',
        id: 'attachment',
        flavour: 'affine:attachment',
        version: 1,
        props: {
          sourceId: 'asset-sha256-original',
          name: 'original.pdf',
          size: 128,
        },
        children: [],
      },
    ],
  },
};

export function importedFixture() {
  const result = importBlockSuiteSnapshot(sourceFixture);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.document;
}
