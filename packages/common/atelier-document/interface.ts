/** Browser offsets are UTF-16 code units. Invalid commands are atomic. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type AtelierDocumentCommand =
  | { type: 'moveBlock'; blockId: string; parentId: string; index: number }
  | { type: 'set'; path: string[]; value: JsonValue }
  | { type: 'delete'; path: string[] }
  | {
      type: 'spliceList';
      path: string[];
      index: number;
      delete: number;
      values: JsonValue[];
    }
  | { type: 'batch'; commands: AtelierDocumentCommand[] }
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
      value: JsonValue;
    };
export interface AtelierBlock {
  id: string;
  flavour: string;
  version?: number;
  parentId: string | null;
  children: string[];
  props: { [key: string]: JsonValue };
}
export interface AtelierDocumentSnapshot {
  schemaVersion: 2;
  documentId: string;
  rootId: string | null;
  metadata: { [key: string]: JsonValue };
  blocks: Record<string, AtelierBlock>;
}
/** Actual implementation is generated with wasm-bindgen into pkg/atelier_document.js. */
export interface AtelierDocumentEngine {
  importSnapshot(snapshotJson: string): void;
  snapshot(): string;
  save(): Uint8Array;
  heads(): string;
  applyCommand(commandJson: string): void;
  merge(bytes: Uint8Array): void;
  /** Unsupported inverses throw; concurrent field changes return false without overwriting them. */
  undo(): boolean;
  redo(): boolean;
  getCursor(pathJson: string, index: number): string;
  resolveCursor(pathJson: string, cursor: string): number;
  generateSyncMessage(peerId: string): Uint8Array | undefined;
  receiveSyncMessage(peerId: string, bytes: Uint8Array): void;
  free(): void;
}
