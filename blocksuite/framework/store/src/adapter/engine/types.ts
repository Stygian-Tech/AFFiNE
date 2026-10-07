/** JSON is the portable boundary between BlockSuite and the Rust/WASM engine. */
export type EngineValue =
  | null
  | boolean
  | number
  | string
  | EngineValue[]
  | { [key: string]: EngineValue };
export type EngineObject = { [key: string]: EngineValue };

/** Structural types keep live Store/Yjs dependencies outside browser WASM hosts. */
export interface BlockSuiteBlockSnapshot {
  type: 'block';
  id: string;
  flavour: string;
  version?: number;
  props: Record<string, unknown>;
  children: BlockSuiteBlockSnapshot[];
}

export interface BlockSuiteDocumentSnapshot {
  type: 'page';
  meta: {
    id: string;
    title: string;
    createDate: number;
    tags: string[];
    updatedDate?: number;
    favorite?: boolean;
    trash?: boolean;
  };
  blocks: BlockSuiteBlockSnapshot;
}

/** Paths address map fields; text indices are UTF-16 code units. */
export type StructuredCommand =
  | { type: 'set'; path: string[]; value: EngineValue }
  | { type: 'delete'; path: string[] }
  | {
      type: 'spliceText';
      path: string[];
      index: number;
      delete: number;
      text: string;
    }
  | {
      type: 'markText';
      path: string[];
      start: number;
      end: number;
      name: string;
      value: EngineValue;
    };

/** The actual wasm-bindgen instance exported by atelier-document. */
export interface WasmDocumentEngine {
  importSnapshot(snapshot: string): void;
  snapshot(): string;
  save(): Uint8Array;
  heads(): string;
  applyCommand(command: string): void;
  merge(checkpoint: Uint8Array): void;
  undo(): boolean;
  generateSyncMessage(peerId: string): Uint8Array | undefined;
  receiveSyncMessage(peerId: string, message: Uint8Array): void;
  free(): void;
}

export interface StructuredBlock {
  id: string;
  flavour: string;
  version?: number;
  parentId: string | null;
  children: string[];
  props: EngineObject;
}

/** A normalized materialized view, not an Automerge checkpoint. */
export interface StructuredDocument {
  schemaVersion: 2;
  documentId: string;
  rootId: string;
  metadata: EngineObject;
  blocks: Record<string, StructuredBlock>;
}

export interface MigrationIssue {
  path: string;
  reason: string;
}

export type SnapshotImportResult =
  | { ok: true; document: StructuredDocument }
  | { ok: false; issues: MigrationIssue[] };

export interface EngineChange {
  origin: 'local' | 'remote' | 'restore';
  heads: string[];
  document: StructuredDocument;
}

/** Hosts must implement this boundary before substituting BlockSuite's store. */
export interface DocumentEngine<Command> {
  read(): StructuredDocument;
  transact(commands: readonly Command[]): void;
  observe(listener: (change: EngineChange) => void): () => void;
  checkpoint(): Uint8Array;
  restore(checkpoint: Uint8Array): void;
  generateSyncMessage(peerId: string): Uint8Array | null;
  receiveSyncMessage(peerId: string, message: Uint8Array): void;
  undo(): boolean;
  redo(): boolean;
  dispose(): void;
}
