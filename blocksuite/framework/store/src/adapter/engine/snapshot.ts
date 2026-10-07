import type {
  BlockSuiteBlockSnapshot,
  BlockSuiteDocumentSnapshot,
  EngineObject,
  EngineValue,
  MigrationIssue,
  SnapshotImportResult,
  StructuredBlock,
  StructuredDocument,
} from './types';

const textMarkers = ['$blocksuite:internal:text$', 'affine:surface:text'];

function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Fail closed: JSON.stringify would silently discard several supported JS values. */
function cloneJSON(
  value: unknown,
  path: string,
  issues: MigrationIssue[],
  ancestors = new Set<object>()
): EngineValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!Array.isArray(value) && !object(value)) {
    issues.push({ path, reason: 'Expected finite, plain JSON snapshot data' });
    return null;
  }
  if (ancestors.has(value)) {
    issues.push({ path, reason: 'Cyclic snapshot data' });
    return null;
  }
  ancestors.add(value);
  const issueCount = issues.length;
  if (Object.getOwnPropertySymbols(value).length) {
    issues.push({ path, reason: 'Symbol-keyed snapshot data' });
  }
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value)
  )) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      issues.push({
        path: `${path}.${key}`,
        reason: 'Non-enumerable or accessor snapshot data',
      });
    }
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) {
      issues.push({ path: `${path}.${key}`, reason: 'Extra array property' });
    }
  }
  // Reject descriptors before Object.entries can execute user-defined getters.
  if (issues.length !== issueCount) {
    ancestors.delete(value);
    return null;
  }
  let result: EngineValue;
  if (Array.isArray(value)) {
    result = Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(value, index)) {
        issues.push({ path: `${path}[${index}]`, reason: 'Sparse array' });
      }
      return cloneJSON(value[index], `${path}[${index}]`, issues, ancestors);
    });
  } else {
    result = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        cloneJSON(child, `${path}.${key}`, issues, ancestors),
      ])
    );
    for (const marker of textMarkers) {
      if (!Object.hasOwn(result, marker)) continue;
      if (result[marker] !== true || !Array.isArray(result.delta)) {
        issues.push({ path, reason: 'Invalid tagged rich text snapshot' });
        continue;
      }
      result.delta.forEach((entry, index) => {
        if (!object(entry) || typeof entry.insert !== 'string') {
          issues.push({
            path: `${path}.delta[${index}]`,
            reason:
              'Rich text embeds or non-insert deltas need an explicit migration',
          });
        }
        if (object(entry)) {
          checkKeys(
            entry,
            ['insert', 'attributes'],
            `${path}.delta[${index}]`,
            issues
          );
          if (entry.attributes !== undefined && !object(entry.attributes)) {
            issues.push({
              path: `${path}.delta[${index}].attributes`,
              reason: 'Invalid rich text attributes',
            });
          }
        }
      });
      checkKeys(result, [marker, 'delta'], path, issues);
    }
  }
  ancestors.delete(value);
  return result;
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: MigrationIssue[]
) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: `${path}.${key}`,
        reason: 'Unknown snapshot envelope field',
      });
    }
  }
}

/** Import Transformer.docToSnapshot output without stripping metadata or properties. */
export function importBlockSuiteSnapshot(
  snapshot: unknown
): SnapshotImportResult {
  const issues: MigrationIssue[] = [];
  snapshot = cloneJSON(snapshot, '$', issues);
  if (issues.length) return { ok: false, issues };
  if (!object(snapshot) || snapshot.type !== 'page' || !object(snapshot.meta)) {
    return {
      ok: false,
      issues: [{ path: '$', reason: 'Expected a DocSnapshot' }],
    };
  }
  checkKeys(snapshot, ['type', 'meta', 'blocks'], '$', issues);
  const metadata = cloneJSON(snapshot.meta, '$.meta', issues) as EngineObject;
  if (
    typeof metadata.id !== 'string' ||
    typeof metadata.title !== 'string' ||
    typeof metadata.createDate !== 'number' ||
    !Array.isArray(metadata.tags) ||
    metadata.tags.some(tag => typeof tag !== 'string')
  ) {
    issues.push({ path: '$.meta', reason: 'Invalid document metadata' });
  }
  const blocks: Record<string, StructuredBlock> = Object.create(null);
  const visited = new Set<object>();
  function visit(
    value: unknown,
    parentId: string | null,
    path: string
  ): string {
    if (!object(value) || visited.has(value)) {
      issues.push({ path, reason: 'Invalid or cyclic block snapshot' });
      return '';
    }
    visited.add(value);
    checkKeys(
      value,
      ['type', 'id', 'flavour', 'version', 'props', 'children'],
      path,
      issues
    );
    if (
      value.type !== 'block' ||
      typeof value.id !== 'string' ||
      typeof value.flavour !== 'string' ||
      !object(value.props) ||
      !Array.isArray(value.children) ||
      (value.version !== undefined &&
        (!Number.isInteger(value.version) || Number(value.version) < 0))
    ) {
      issues.push({ path, reason: 'Invalid block snapshot fields' });
      return '';
    }
    if (Object.hasOwn(blocks, value.id)) {
      issues.push({
        path: `${path}.id`,
        reason: `Duplicate block id: ${value.id}`,
      });
      return value.id;
    }
    const block: StructuredBlock = {
      id: value.id,
      flavour: value.flavour,
      parentId,
      children: [],
      props: cloneJSON(value.props, `${path}.props`, issues) as EngineObject,
      ...(value.version === undefined
        ? {}
        : { version: Number(value.version) }),
    };
    blocks[value.id] = block;
    block.children = value.children.map((child, index) =>
      visit(child, block.id, `${path}.children[${index}]`)
    );
    return block.id;
  }
  const rootId = visit(snapshot.blocks, null, '$.blocks');
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    document: {
      schemaVersion: 2,
      documentId: metadata.id as string,
      rootId,
      metadata,
      blocks,
    },
  };
}

/** Migration readback. The engine must supply a validated, acyclic materialized view. */
export function exportBlockSuiteSnapshot(
  document: StructuredDocument
): BlockSuiteDocumentSnapshot {
  const visited = new Set<string>();
  function visit(id: string, parentId: string | null): BlockSuiteBlockSnapshot {
    const block = document.blocks[id];
    if (!block || visited.has(id) || block.parentId !== parentId) {
      throw new Error(`Invalid materialized block tree at ${id}`);
    }
    visited.add(id);
    return {
      type: 'block',
      id,
      flavour: block.flavour,
      ...(block.version === undefined ? {} : { version: block.version }),
      props: structuredClone(block.props),
      children: block.children.map(child => visit(child, id)),
    };
  }
  const blocks = visit(document.rootId, null);
  if (visited.size !== Object.keys(document.blocks).length) {
    throw new Error('Unreachable blocks in materialized document');
  }
  return {
    type: 'page',
    meta: structuredClone(
      document.metadata
    ) as unknown as BlockSuiteDocumentSnapshot['meta'],
    blocks,
  };
}
