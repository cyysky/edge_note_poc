import { expect, test } from '@playwright/test';

test.describe('notes', () => {
  test('shows the empty state on a fresh database', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Notes' })).toBeVisible();
    await expect(page.getByText('No notes yet.')).toBeVisible();
  });

  test('creates, edits and deletes a note through the UI', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Create the first note' }).click();

    const dialog = page.getByRole('dialog', { name: 'New note' });
    await expect(dialog).toBeVisible();

    // `showModal()` puts the dialog in the top layer as :modal; the `open`
    // attribute alone would satisfy `[open]` but never `:modal`.
    await expect
      .poll(() => page.evaluate(() => document.querySelector('dialog')?.matches(':modal') ?? false))
      .toBe(true);

    await page.getByLabel('Title').fill('Grocery list');
    await page.getByLabel('Body').fill('Milk, eggs, bread');
    await page.getByRole('button', { name: 'Save note' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('rowheader', { name: 'Grocery list' })).toBeVisible();
    await expect(page.getByText('Milk, eggs, bread')).toBeVisible();

    await page.getByRole('button', { name: 'Edit Grocery list' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit note' });
    await expect(editDialog).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('Grocery list');

    await page.getByLabel('Title').fill('Groceries');
    await page.getByRole('button', { name: 'Save note' }).click();

    await expect(editDialog).toBeHidden();
    await expect(page.getByRole('rowheader', { name: 'Groceries' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Groceries' }).click();
    await expect(page.getByText('No notes yet.')).toBeVisible();
  });

  test('closes the dialog on Escape and returns focus to the invoker', async ({ page }) => {
    await page.goto('/');

    const invoker = page.getByRole('button', { name: 'Create the first note' });
    await invoker.click();

    const dialog = page.getByRole('dialog', { name: 'New note' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Title')).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(invoker).toBeFocused();
  });

  test('blocks saving a blank title', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Create the first note' }).click();
    await expect(page.getByRole('button', { name: 'Save note' })).toBeDisabled();

    await page.getByLabel('Title').fill('   ');
    await expect(page.getByRole('button', { name: 'Save note' })).toBeDisabled();
  });

  test('keep the note when the API rejects the update', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create the first note' }).click();
    await page.getByLabel('Title').fill('Keep me');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByRole('rowheader', { name: 'Keep me' })).toBeVisible();

    // Force a network-level failure only for the update request.
    await page.route('**/api/notes/*', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' },
            }),
          })
        : route.continue(),
    );

    await page.getByRole('button', { name: 'Edit Keep me' }).click();
    await page.getByLabel('Title').fill('Should not stick');
    await page.getByRole('button', { name: 'Save note' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'Unexpected server error.',
    );

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('rowheader', { name: 'Keep me' })).toBeVisible();
  });
});
