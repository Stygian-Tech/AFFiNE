import { expect, test } from '@playwright/test';

test('real WASM fixture, native text marks, concurrent peer sync, selective undo and canvas model converge', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Atelier structured document gate');
  await expect(
    page.getByRole('heading', { name: 'Structured document engine' })
  ).toBeVisible();
  await expect(
    page.getByText('BlockSuite editor gate: NOT PASSED.')
  ).toBeVisible();
  await expect(page.getByTestId('text-A').locator('v-line')).toHaveCount(1);
  await expect(page.getByTestId('fixture-fidelity')).toHaveText(
    'Fixture fidelity: passed'
  );
  await page.getByRole('button', { name: 'Bold A', exact: true }).click();
  await expect(
    page.getByTestId('text-A').locator('[data-v-text]').first()
  ).toHaveCSS('font-weight', '700');
  await page.getByRole('button', { name: 'Synchronize replicas' }).click();
  await page.getByRole('button', { name: 'Append A', exact: true }).click();
  await page.getByRole('button', { name: 'Append B', exact: true }).click();
  await expect(page.getByTestId('convergence')).toHaveText(
    'Replicas: diverged'
  );
  await page.getByRole('button', { name: 'Synchronize replicas' }).click();
  await expect(page.getByTestId('convergence')).toHaveText(
    'Replicas: converged'
  );
  await expect(page.getByTestId('text-A')).toContainText('A');
  await expect(page.getByTestId('text-A')).toContainText('B');
  await page.getByRole('button', { name: 'Undo A', exact: true }).click();
  await page.getByRole('button', { name: 'Synchronize replicas' }).click();
  await expect(page.getByTestId('text-A')).toHaveText('Hello Atelier B');
  await expect(page.getByTestId('text-B')).toHaveText('Hello Atelier B');
  await page.getByRole('button', { name: 'Move B', exact: true }).click();
  await expect(page.getByTestId('shape-B')).toHaveAttribute('x', '50');
  await page.getByRole('button', { name: 'Synchronize replicas' }).click();
  await expect(page.getByTestId('shape-A')).toHaveAttribute('x', '50');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
  expect(errors).toEqual([]);
});

test('actual BlockSuite inline editor handles browser input backed by Automerge and peer updates', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'BlockSuite text A' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor.locator('v-line')).toHaveCount(1);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('!');
  await expect(editor).toHaveText('Hello Atelier!');
  await page.getByRole('button', { name: 'Synchronize replicas' }).click();
  await expect(page.getByTestId('text-B')).toHaveText('Hello Atelier!');
  await page.getByRole('button', { name: 'Undo A', exact: true }).click();
  await expect(editor).toHaveText('Hello Atelier');
  await page.getByRole('button', { name: 'Redo A', exact: true }).click();
  await expect(editor).toHaveText('Hello Atelier!');
  await page.getByRole('button', { name: 'Save checkpoint' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.reload();
  await page.getByRole('button', { name: 'Restore checkpoint' }).click();
  await expect(page.getByTestId('text-A')).toHaveText('Hello Atelier!');
  await expect(page.getByTestId('text-A').locator('v-line')).toHaveCount(1);
});

test('IndexedDB acknowledges save after commit and restores retained structured data after reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Append A', exact: true }).click();
  await page.getByRole('button', { name: 'Move A', exact: true }).click();
  await page.getByRole('button', { name: 'Save checkpoint' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Saved locally to IndexedDB'
  );
  await page.reload();
  await expect(page.getByTestId('text-A')).toHaveText('Hello Atelier');
  await page.getByRole('button', { name: 'Restore checkpoint' }).click();
  await expect(page.getByTestId('text-A')).toHaveText('Hello Atelier A');
  await expect(page.getByTestId('text-B')).toHaveText('Hello Atelier A');
  await expect(page.getByTestId('shape-A')).toHaveAttribute('x', '50');
  const retained = JSON.parse(
    (await page.getByTestId('snapshot-A').textContent()) ?? '{}'
  );
  expect(retained.blocks.database.props.cells.paragraph.title).toBe(
    'Preserved'
  );
  expect(retained.blocks.attachment.props.sourceId).toBe(
    'asset-sha256-original'
  );
  expect(retained.blocks.surface.props.elements.connector.source.id).toBe(
    'shape'
  );
  expect(retained.blocks.note.children).toEqual(['paragraph']);
});

test('model harness explains missing real editor capability and fits a mobile viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByText('BlockSuite editor gate: NOT PASSED.')
  ).toBeVisible();
  // No original editor is mounted: a model rendering must not silently count as editor QA.
  await expect(
    page.locator('editor-host, affine-page-root, affine-edgeless-root')
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png') });
});
