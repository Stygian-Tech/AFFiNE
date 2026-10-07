import type {
  RichTextAdapter,
  RichTextAnchor,
  RichTextDelta,
} from '@blocksuite/store/engine';
import { expect, test } from 'vitest';
import * as Y from 'yjs';

import { InlineEditor } from '../../inline/inline-editor';
import { YjsRichTextAdapter } from '../../inline/text-adapter';

/** A contract probe with no Y.Doc: native convergence is tested by the WASM host. */
class ProbeText implements RichTextAdapter {
  value = 'hello';
  attrs: Record<string, unknown> = {};
  transactions: boolean[] = [];
  listeners = new Set<(change: { local: boolean }) => void>();
  get length() {
    return this.value.length;
  }
  toString() {
    return this.value;
  }
  toDelta(): RichTextDelta[] {
    return [{ insert: this.value, attributes: this.attrs }];
  }
  insert(index: number, text: string, attributes?: Record<string, unknown>) {
    this.value = this.value.slice(0, index) + text + this.value.slice(index);
    this.attrs = attributes ?? {};
  }
  delete(index: number, length: number) {
    this.value = this.value.slice(0, index) + this.value.slice(index + length);
  }
  format(_index: number, _length: number, attributes: Record<string, unknown>) {
    this.attrs = attributes;
  }
  transact(callback: () => void, withoutHistory = false) {
    this.transactions.push(withoutHistory);
    callback();
    this.listeners.forEach(listener => listener({ local: true }));
  }
  observe(listener: (change: { local: boolean }) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  createAnchor(index: number): RichTextAnchor {
    return { index };
  }
  resolveAnchor(anchor: RichTextAnchor) {
    return typeof anchor === 'string'
      ? null
      : (anchor as { index: number }).index;
  }
}

test('InlineEditor reads and mutates an injected text backend without creating a Y.Doc', () => {
  const backend = new ProbeText();
  const editor = new InlineEditor(backend);
  expect(editor.yTextString).toBe('hello');
  expect(editor.yTextLength).toBe(5);
  editor.insertText({ index: 1, length: 2 }, '🙂', { bold: true });
  expect(backend.value).toBe('h🙂lo');
  expect(editor.yTextLength).toBe(5);
  expect(editor.yTextDeltas[0].attributes).toEqual({ bold: true });
  editor.deleteText({ index: 1, length: 2 });
  expect(editor.yTextString).toBe('hlo');
  expect(backend.transactions).toEqual([false, false]);
  expect(() => editor.yText).toThrow('no Y.Text exists');
  editor.setReadonly(true);
  editor.insertText({ index: 0, length: 0 }, 'ignored');
  expect(editor.yTextString).toBe('hlo');
});

test('Yjs adapter retains transaction origins and stable positions across remote edits', () => {
  const doc = new Y.Doc();
  const yText = doc.getText('text');
  yText.insert(0, 'hello');
  const backend = new YjsRichTextAdapter(yText);
  const anchor = backend.createAnchor(3);
  const changes: boolean[] = [];
  const unsubscribe = backend.observe(change => changes.push(change.local));
  backend.transact(() => backend.insert(0, 'A'));
  expect(backend.resolveAnchor(anchor)).toBe(4);
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  peer.getText('text').insert(0, 'B');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
  expect(backend.resolveAnchor(anchor)).toBe(5);
  expect(changes).toEqual([true, false]);
  unsubscribe();
  backend.transact(() => backend.insert(0, 'C'));
  expect(changes).toEqual([true, false]);
  doc.destroy();
  peer.destroy();
});

test('default InlineEditor retains original Y.Text and without-history origin', () => {
  const doc = new Y.Doc();
  const yText = doc.getText('text');
  const editor = new InlineEditor(yText);
  expect(editor.yText).toBe(yText);
  const origins: unknown[] = [];
  doc.on('afterTransaction', transaction => origins.push(transaction.origin));
  editor.transact(() => editor.textBackend.insert(0, 'one'));
  editor.transact(() => editor.textBackend.insert(0, 'two'), true);
  expect(origins).toEqual([doc.clientID, null]);
  doc.destroy();
});

test('unattached Y.Text still rejects and carriage returns reject either backend', () => {
  expect(() => new InlineEditor(new Y.Text())).toThrow('attached to a Y.Doc');
  const backend = new ProbeText();
  backend.value = 'bad\rtext';
  expect(() => new InlineEditor(backend)).toThrow('must not contain');
});
