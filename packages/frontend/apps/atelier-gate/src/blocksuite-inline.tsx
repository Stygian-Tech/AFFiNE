import { useEffect, useRef, useState } from 'react';

import { VElement } from '../../../../../blocksuite/framework/std/src/inline/components/v-element';
import { VLine } from '../../../../../blocksuite/framework/std/src/inline/components/v-line';
import { VText } from '../../../../../blocksuite/framework/std/src/inline/components/v-text';
import { InlineEditor } from '../../../../../blocksuite/framework/std/src/inline/inline-editor';
import { AutomergeTextAdapter } from '../../../../../blocksuite/framework/store/src/adapter/engine/automerge-text';
import type { WasmDocumentHost } from '../../../../../blocksuite/framework/store/src/adapter/engine/wasm-host';

for (const [tag, component] of [
  ['v-element', VElement],
  ['v-line', VLine],
  ['v-text', VText],
] as const) {
  if (!customElements.get(tag)) customElements.define(tag, component);
}
const path = ['blocks', 'paragraph', 'props', 'text'];

/** The actual BlockSuite InlineEditor edits authoritative Automerge state. */
export function BlockSuiteInline({
  host,
  label,
}: {
  host: WasmDocumentHost;
  label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const backend = new AutomergeTextAdapter(host, path);
    const editor = new InlineEditor(backend);
    const historyShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.isComposing
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      try {
        const range = editor.getInlineRange();
        const start = range ? backend.createAnchor(range.index) : null;
        const end = range
          ? backend.createAnchor(range.index + range.length)
          : null;
        if (key === 'y' || event.shiftKey) host.redo();
        else host.undo();
        if (start !== null && end !== null) {
          const index = backend.resolveAnchor(start);
          const last = backend.resolveAnchor(end);
          if (index !== null && last !== null)
            editor.setInlineRange({ index, length: Math.max(0, last - index) });
        }
        setError('');
      } catch (failure) {
        setError(String(failure));
      }
    };
    try {
      editor.mount(element);
      element.addEventListener('keydown', historyShortcut);
      setError('');
    } catch (failure) {
      setError(String(failure));
    }
    return () => {
      element.removeEventListener('keydown', historyShortcut);
      editor.unmount();
    };
  }, [host]);
  return (
    <>
      <div
        ref={root}
        className="richtext"
        data-testid={`text-${label}`}
        role="textbox"
        aria-label={`BlockSuite text ${label}`}
        aria-multiline="true"
      />
      {error && (
        <p role="alert" className="error">
          BlockSuite InlineEditor failed: {error}
        </p>
      )}
    </>
  );
}
