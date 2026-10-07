import type {
  RichTextAdapter,
  RichTextAnchor,
  RichTextDelta,
} from './rich-text';
import type { EngineValue, StructuredCommand } from './types';
import type { WasmDocumentHost } from './wasm-host';

/** A path-bound text handle; the WASM document remains the editing authority. */
export class AutomergeTextAdapter implements RichTextAdapter {
  private pending: StructuredCommand[] | null = null;
  private staged: RichTextDelta[] | null = null;

  constructor(
    private readonly host: WasmDocumentHost,
    private readonly path: string[]
  ) {
    this.toDelta();
  }

  get length(): number {
    return this.toString().length;
  }

  toString(): string {
    return this.toDelta()
      .map(span => span.insert)
      .join('');
  }

  toDelta(): RichTextDelta[] {
    if (this.staged) return structuredClone(this.staged);
    let value: unknown = this.host.read();
    for (const key of this.path) {
      value = (value as Record<string, unknown>)[key];
    }
    const text = value as { delta?: RichTextDelta[] };
    if (!Array.isArray(text?.delta)) throw new Error('Path is not rich text');
    return structuredClone(text.delta);
  }

  insert(
    index: number,
    text: string,
    attributes?: Record<string, unknown>
  ): void {
    this.transact(() => {
      // Match Y.Text's implicit insertion marks: inherit from the preceding
      // character, and use no marks at the beginning of the text.
      const inherited =
        index > 0 ? this.slice(index - 1, index)[0]?.attributes : undefined;
      const applied = attributes ?? inherited ?? {};
      const marks: Record<string, unknown> = {};
      for (const span of this.staged!) {
        for (const name of Object.keys(span.attributes ?? {}))
          marks[name] = null;
      }
      Object.assign(marks, applied);
      this.enqueue({
        type: 'spliceText',
        path: this.path,
        index,
        delete: 0,
        text,
      });
      this.edit(index, 0, [{ insert: text, attributes: applied }]);
      if (text.length && Object.keys(marks).length)
        this.format(index, text.length, marks);
    });
  }

  delete(index: number, length: number): void {
    this.transact(() => {
      this.enqueue({
        type: 'spliceText',
        path: this.path,
        index,
        delete: length,
        text: '',
      });
      this.edit(index, length, []);
    });
  }

  format(
    index: number,
    length: number,
    attributes: Record<string, unknown>
  ): void {
    this.transact(() => {
      for (const [name, value] of Object.entries(attributes)) {
        this.enqueue({
          type: 'markText',
          path: this.path,
          start: index,
          end: index + length,
          name,
          value: value as EngineValue,
        });
      }
      const spans = this.slice(index, index + length).map(span => {
        const next = { ...span.attributes, ...attributes };
        for (const key of Object.keys(next))
          if (next[key] === null) delete next[key];
        return { insert: span.insert, attributes: next };
      });
      this.edit(index, length, spans);
    });
  }

  transact(callback: () => void, withoutHistory = false): void {
    if (withoutHistory)
      throw new Error('Automerge history exclusion is not implemented');
    if (this.pending) {
      callback();
      return;
    }
    this.staged = this.toDelta();
    this.pending = [];
    try {
      callback();
      const commands = this.pending;
      this.pending = null;
      this.staged = null;
      this.host.transact(commands);
    } finally {
      this.pending = null;
      this.staged = null;
    }
  }

  observe(listener: (change: { local: boolean }) => void): () => void {
    let previous = JSON.stringify(this.toDelta());
    return this.host.observe(change => {
      const next = JSON.stringify(this.toDelta());
      if (previous === next) return;
      previous = next;
      listener({ local: change.origin === 'local' });
    });
  }

  createAnchor(index: number): RichTextAnchor {
    if (this.pending)
      throw new Error(
        'Cannot create anchors inside an uncommitted text transaction'
      );
    return this.host.getCursor(this.path, index);
  }

  resolveAnchor(anchor: RichTextAnchor): number | null {
    if (typeof anchor !== 'string') return null;
    try {
      return this.host.resolveCursor(this.path, anchor);
    } catch {
      return null;
    }
  }

  private enqueue(command: StructuredCommand): void {
    this.pending!.push(command);
  }

  private slice(start: number, end: number): RichTextDelta[] {
    const spans: RichTextDelta[] = [];
    let offset = 0;
    for (const span of this.staged!) {
      const from = Math.max(0, start - offset);
      const to = Math.min(span.insert.length, end - offset);
      if (to > from)
        spans.push({ ...span, insert: span.insert.slice(from, to) });
      offset += span.insert.length;
    }
    return spans;
  }

  private edit(
    index: number,
    length: number,
    replacement: RichTextDelta[]
  ): void {
    const total = this.staged!.reduce(
      (sum, span) => sum + span.insert.length,
      0
    );
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(length) ||
      index < 0 ||
      length < 0 ||
      index + length > total
    ) {
      throw new Error('Text range is out of bounds');
    }
    this.staged = [
      ...this.slice(0, index),
      ...replacement,
      ...this.slice(index + length, total),
    ].filter(span => span.insert.length > 0);
  }
}
