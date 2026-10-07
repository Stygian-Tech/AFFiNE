/** Opaque position owned by the CRDT; never a transient numeric editor offset. */
export type RichTextAnchor = object | string;

export interface RichTextDelta {
  insert: string;
  attributes?: Record<string, unknown>;
}

/** Minimal engine-neutral contract consumed by BlockSuite's inline editor. */
export interface RichTextAdapter {
  readonly length: number;
  toString(): string;
  toDelta(): RichTextDelta[];
  insert(
    index: number,
    text: string,
    attributes?: Record<string, unknown>
  ): void;
  delete(index: number, length: number): void;
  format(
    index: number,
    length: number,
    attributes: Record<string, unknown>
  ): void;
  transact(callback: () => void, withoutHistory?: boolean): void;
  observe(listener: (change: { local: boolean }) => void): () => void;
  createAnchor(index: number): RichTextAnchor;
  resolveAnchor(anchor: RichTextAnchor): number | null;
}
