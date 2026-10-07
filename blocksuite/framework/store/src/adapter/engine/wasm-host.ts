import type {
  DocumentEngine,
  EngineChange,
  StructuredCommand,
  StructuredDocument,
  WasmDocumentEngine,
} from './types';

export interface WasmEngineFactory {
  load(checkpoint: Uint8Array, actor: string): WasmDocumentEngine;
}

/** Observable host around one authoritative Automerge replica. */
export class WasmDocumentHost implements DocumentEngine<StructuredCommand> {
  private engine: WasmDocumentEngine;
  private readonly listeners = new Set<(change: EngineChange) => void>();
  private document: StructuredDocument;
  private heads: string[];
  private disposed = false;

  constructor(
    engine: WasmDocumentEngine,
    private readonly factory: WasmEngineFactory,
    private readonly actor: () => string = () => crypto.randomUUID(),
    private readonly onObserverError: (error: unknown) => void = error =>
      globalThis.reportError(error)
  ) {
    this.engine = engine;
    this.document = this.materialize(engine);
    this.heads = JSON.parse(engine.heads()) as string[];
  }

  read(): StructuredDocument {
    this.assertOpen();
    return this.document;
  }

  transact(commands: readonly StructuredCommand[]): void {
    this.assertOpen();
    if (!commands.length) return;
    this.engine.applyCommand(JSON.stringify({ type: 'batch', commands }));
    this.publish('local');
  }

  observe(listener: (change: EngineChange) => void): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  checkpoint(): Uint8Array {
    this.assertOpen();
    return this.engine.save();
  }

  restore(checkpoint: Uint8Array): void {
    this.assertOpen();
    const replacement = this.factory.load(checkpoint, this.actor());
    let document: StructuredDocument;
    try {
      document = this.materialize(replacement);
      if (document.documentId !== this.document.documentId) {
        throw new Error('Cannot restore a checkpoint from another document');
      }
    } catch (error) {
      replacement.free();
      throw error;
    }
    this.engine.free();
    this.engine = replacement;
    this.document = document;
    this.publish('restore', true);
  }

  generateSyncMessage(peerId: string): Uint8Array | null {
    this.assertOpen();
    return this.engine.generateSyncMessage(peerId) ?? null;
  }

  receiveSyncMessage(peerId: string, message: Uint8Array): void {
    this.assertOpen();
    this.engine.receiveSyncMessage(peerId, message);
    this.publish('remote');
  }

  undo(): boolean {
    this.assertOpen();
    const changed = this.engine.undo();
    this.publish('local');
    return changed;
  }

  redo(): boolean {
    this.assertOpen();
    const changed = this.engine.redo();
    this.publish('local');
    return changed;
  }

  getCursor(path: readonly string[], index: number): string {
    this.assertOpen();
    return this.engine.getCursor(JSON.stringify(path), index);
  }

  resolveCursor(path: readonly string[], cursor: string): number {
    this.assertOpen();
    return this.engine.resolveCursor(JSON.stringify(path), cursor);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.engine.free();
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Document host has been disposed');
  }

  private materialize(engine: WasmDocumentEngine): StructuredDocument {
    const document = JSON.parse(engine.snapshot()) as StructuredDocument;
    if (!document.rootId)
      throw new Error('Document host requires a rooted document');
    return freeze(document);
  }

  private publish(origin: EngineChange['origin'], force = false): void {
    const heads = JSON.parse(this.engine.heads()) as string[];
    if (!force && JSON.stringify(heads) === JSON.stringify(this.heads)) return;
    this.heads = heads;
    this.document = this.materialize(this.engine);
    const change = { origin, heads: [...heads], document: this.document };
    // Subscriptions changed during notification belong to the next event.
    const listeners = [...this.listeners];
    for (const listener of listeners) {
      try {
        listener(change);
      } catch (error) {
        this.onObserverError(error);
      }
    }
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
