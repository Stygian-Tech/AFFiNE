import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import type {
  RichTextAdapter,
  RichTextAnchor,
  RichTextDelta,
} from '@blocksuite/store/engine';
import * as Y from 'yjs';

/** Preserves the existing Yjs editor path behind the engine-neutral contract. */
export class YjsRichTextAdapter implements RichTextAdapter {
  constructor(readonly yText: Y.Text) {
    if (!yText.doc) {
      throw new BlockSuiteError(
        ErrorCode.InlineEditorError,
        'yText must be attached to a Y.Doc'
      );
    }
  }

  get length() {
    return this.yText.length;
  }
  toString() {
    return this.yText.toString();
  }
  toDelta(): RichTextDelta[] {
    return this.yText.toDelta();
  }
  insert(index: number, text: string, attributes?: Record<string, unknown>) {
    this.yText.insert(index, text, attributes);
  }
  delete(index: number, length: number) {
    this.yText.delete(index, length);
  }
  format(index: number, length: number, attributes: Record<string, unknown>) {
    this.yText.format(index, length, attributes);
  }
  transact(callback: () => void, withoutHistory = false) {
    const doc = this.yText.doc;
    if (!doc)
      throw new BlockSuiteError(
        ErrorCode.InlineEditorError,
        'yText is not attached to a doc'
      );
    doc.transact(callback, withoutHistory ? null : doc.clientID);
  }
  observe(listener: (change: { local: boolean }) => void) {
    const handler = (_: Y.YTextEvent, transaction: Y.Transaction) =>
      listener({ local: transaction.local });
    this.yText.observe(handler);
    return () => this.yText.unobserve(handler);
  }
  createAnchor(index: number): RichTextAnchor {
    return Y.createRelativePositionFromTypeIndex(this.yText, index);
  }
  resolveAnchor(anchor: RichTextAnchor): number | null {
    const doc = this.yText.doc;
    if (!doc || typeof anchor === 'string') return null;
    const position = Y.createAbsolutePositionFromRelativePosition(
      anchor as Y.RelativePosition,
      doc
    );
    return position?.type === this.yText ? position.index : null;
  }
}

export function asRichTextAdapter(
  value: Y.Text | RichTextAdapter
): RichTextAdapter {
  return value instanceof Y.Text ? new YjsRichTextAdapter(value) : value;
}
