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
    const editor = new InlineEditor(new AutomergeTextAdapter(host, path));
    try {
      editor.mount(element);
      setError('');
    } catch (failure) {
      setError(String(failure));
    }
    return () => editor.unmount();
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
