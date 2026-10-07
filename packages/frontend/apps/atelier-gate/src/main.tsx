import './style.css';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { exportBlockSuiteSnapshot } from '../../../../../blocksuite/framework/store/src/adapter/engine/snapshot';
import type {
  StructuredCommand,
  StructuredDocument,
} from '../../../../../blocksuite/framework/store/src/adapter/engine/types';
import { WasmDocumentHost } from '../../../../../blocksuite/framework/store/src/adapter/engine/wasm-host';
import init, {
  DocumentEngine,
} from '../../../../common/atelier-document/pkg/atelier_document.js';
import { BlockSuiteInline } from './blocksuite-inline';
import { loadCheckpoint, storeCheckpoint } from './checkpoints';
import { importedFixture, sourceFixture } from './fixture';

type Delta = { insert: string; attributes?: Record<string, unknown> };
const textPath = ['blocks', 'paragraph', 'props', 'text'];
await init();
const seed = new DocumentEngine('atelier-gate', crypto.randomUUID());
seed.importSnapshot(JSON.stringify(importedFixture()));
const checkpoint = seed.save();
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(key => [key, v[key]])
        )
      : v
  );
}
const initialFidelity =
  canonical(exportBlockSuiteSnapshot(JSON.parse(seed.snapshot()))) ===
  canonical(sourceFixture);
seed.free();

function read(engine: WasmDocumentHost): StructuredDocument {
  return engine.read();
}

function replicas(bytes: Uint8Array): WasmDocumentHost[] {
  const load = () => {
    const engine = DocumentEngine.load(bytes, crypto.randomUUID());
    try {
      return new WasmDocumentHost(engine, DocumentEngine);
    } catch (failure) {
      engine.free();
      throw failure;
    }
  };
  const left = load();
  try {
    return [left, load()];
  } catch (failure) {
    left.dispose();
    throw failure;
  }
}

function exchange(left: WasmDocumentHost, right: WasmDocumentHost) {
  for (let round = 0; round < 20; round++) {
    const a = left.generateSyncMessage('right');
    const b = right.generateSyncMessage('left');
    if (!a && !b) return;
    if (a) right.receiveSyncMessage('left', a);
    if (b) left.receiveSyncMessage('right', b);
  }
  throw new Error('Automerge synchronization did not quiesce after 20 rounds');
}

function App() {
  const [engines, setEngines] = useState(() => replicas(checkpoint));
  useEffect(() => () => engines.forEach(engine => engine.dispose()), [engines]);
  const [, setRevision] = useState(0);
  useEffect(() => {
    const unsubscribe = engines.map(engine =>
      engine.observe(() => setRevision(n => n + 1))
    );
    return () => unsubscribe.forEach(dispose => dispose());
  }, [engines]);
  const [status, setStatus] = useState(
    'Imported BlockSuite fixture into native Automerge state.'
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const documents = engines.map(read);
  const run = (operation: () => void | Promise<void>, message: string) => {
    setBusy(true);
    setError('');
    (async () => {
      try {
        await operation();
        setStatus(message);
      } catch (failure) {
        setError(String(failure));
      } finally {
        setRevision(n => n + 1);
        setBusy(false);
      }
    })().catch(failure => {
      setError(String(failure));
      setBusy(false);
    });
  };
  const command = (index: number, value: StructuredCommand, message: string) =>
    run(() => engines[index].transact([value]), message);
  return (
    <main>
      <span>ATELIER NOTES · COMPATIBILITY WORKBENCH</span>
      <h1>Structured document engine</h1>
      <p className="notice">
        <strong>BlockSuite editor gate: NOT PASSED.</strong> This is a React
        workbench with the real BlockSuite inline text editor using Rust/WASM
        Automerge. The full AFFiNE block and canvas editors still require
        Yjs-backed Store and canvas interfaces. Browser iroh, OAuth, and PDS
        integration are pending that gate.
      </p>
      <p data-testid="fixture-fidelity">
        Fixture fidelity: {initialFidelity ? 'passed' : 'FAILED'}
      </p>
      <div className="actions">
        <button
          disabled={busy}
          onClick={() =>
            run(
              () => exchange(engines[0], engines[1]),
              'Peer protocol synchronized both replicas.'
            )
          }
        >
          Synchronize replicas
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(
              () => storeCheckpoint(engines[0].checkpoint()),
              'Saved locally to IndexedDB; no PDS upload performed.'
            )
          }
        >
          Save checkpoint
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const bytes = await loadCheckpoint();
              setEngines(replicas(bytes));
            }, 'Restored both replicas from the committed local checkpoint.')
          }
        >
          Restore checkpoint
        </button>
      </div>
      <div role="status" className="status">
        {status}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p data-testid="convergence">
        Replicas:{' '}
        {canonical(documents[0]) === canonical(documents[1])
          ? 'converged'
          : 'diverged'}
      </p>
      <div className="replicas">
        {documents.map((doc, index) => {
          const label = index === 0 ? 'A' : 'B';
          const text = doc.blocks.paragraph.props.text as unknown as {
            delta: Delta[];
          };
          const length = text.delta.reduce(
            (count, span) => count + span.insert.length,
            0
          );
          const elements = doc.blocks.surface.props.elements as unknown as {
            shape: { xywh: string };
            connector: unknown;
          };
          const [x, y, width, height] = JSON.parse(
            elements.shape.xywh
          ) as number[];
          return (
            <section
              key={label}
              className="replica"
              aria-label={`Replica ${label}`}
            >
              <h2>Replica {label}</h2>
              <BlockSuiteInline host={engines[index]} label={label} />
              <svg
                viewBox="0 0 320 160"
                role="img"
                aria-label={`Canvas model ${label}`}
              >
                <line
                  x1={x + width}
                  y1={y + height / 2}
                  x2="270"
                  y2="70"
                  stroke="#445"
                  strokeWidth="2"
                />
                <rect
                  data-testid={`shape-${label}`}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  rx="6"
                  fill="#dce9ff"
                  stroke="#557099"
                />
                <text x={x + 12} y={y + 35}>
                  Shape
                </text>
              </svg>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    command(
                      index,
                      {
                        type: 'spliceText',
                        path: textPath,
                        index: length,
                        delete: 0,
                        text: ` ${label}`,
                      },
                      `Replica ${label} inserted text locally.`
                    )
                  }
                >
                  Append {label}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    command(
                      index,
                      {
                        type: 'markText',
                        path: textPath,
                        start: 0,
                        end: 5,
                        name: 'bold',
                        value: true,
                      },
                      `Replica ${label} marked text bold.`
                    )
                  }
                >
                  Bold {label}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    command(
                      index,
                      {
                        type: 'set',
                        path: [
                          'blocks',
                          'surface',
                          'props',
                          'elements',
                          'shape',
                          'xywh',
                        ],
                        value: `[${x + 20},${y},${width},${height}]`,
                      },
                      `Replica ${label} moved the canvas shape.`
                    )
                  }
                >
                  Move {label}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() => {
                      if (!engines[index].undo())
                        throw new Error(
                          'No supported local undo operation remains.'
                        );
                    }, `Replica ${label} undid its last local operation.`)
                  }
                >
                  Undo {label}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() => {
                      if (!engines[index].redo())
                        throw new Error('No local redo operation remains.');
                    }, `Replica ${label} redid its last local operation.`)
                  }
                >
                  Redo {label}
                </button>
              </div>
              <details>
                <summary>Materialized block document</summary>
                <pre data-testid={`snapshot-${label}`}>
                  {JSON.stringify(doc, null, 2)}
                </pre>
              </details>
            </section>
          );
        })}
      </div>
      <p>
        Database columns, cells, views, attachment IDs, connector endpoints, and
        block ordering are retained in the fixture. They are not editable
        through the original BlockSuite UI here.
      </p>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
