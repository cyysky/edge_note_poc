import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

/**
 * The sample WAV is 90 kB, which becomes ~121 kB once base64-encoded. That is
 * the exact size that used to be rejected by Express' 100 kB default before
 * validation could run, so the upload is the regression test, not decoration.
 */
const sampleWav = fileURLToPath(new URL('../../../samples/test_speech.wav', import.meta.url));

test.describe('chat', () => {
  test('answers a text question and shows the tool trace', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();
    await page.getByLabel('Message').fill('create a note about the deck');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('LFM3-Omni')).toBeVisible();
    const trace = page.getByText('1 tool call');
    await expect(trace).toBeVisible();
    // A closed `<details>` hides its content, so open it before asserting.
    await trace.click();
    await expect(page.getByText('list_notes')).toBeVisible();
  });

  test('uploads an audio clip past the old 100 kB JSON limit', async ({ page }) => {
    const bytes = await readFile(sampleWav);
    expect(bytes.byteLength).toBeGreaterThan(80_000);

    await page.goto('/chat');
    await page.getByLabel('Add audio').setInputFiles(sampleWav);
    await page.getByLabel('Speak replies').uncheck();

    // The transcript is derived while the clip is still an attachment. Scope to
    // the card: the composer's status region also announces it.
    await expect(page.locator('.chat-attachment-text')).toHaveText(
      'The quick brown fox jumps over the lazy dog.',
    );

    await page.getByLabel('Message').fill('what do you hear');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(
      page.getByText('You gave me: Audio 1: The quick brown fox jumps over the lazy dog.'),
    ).toBeVisible();
    await expect(page.locator('.alert[role="alert"]')).toHaveCount(0);
  });

  test('captions a picture before sending and keeps the caption in later turns', async ({
    page,
  }) => {
    await page.goto('/chat');
    await page.getByLabel('Speak replies').uncheck();
    await page.getByLabel('Add image').setInputFiles({
      name: 'shapes.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    const caption = page.locator('.chat-attachment-text');
    await expect(caption).toHaveText('A red circle on a plain background.');

    // The send button waits for the caption, so a click here would be a no-op.
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(
      page.getByText('You gave me: Image 1: A red circle on a plain background.'),
    ).toBeVisible();

    // The bytes are gone from later requests; the caption is what carries over.
    await page.getByLabel('Message').fill('and the colour?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.chat-derived')).toHaveCount(1);
    await expect(page.locator('.chat-derived')).toHaveText('A red circle on a plain background.');
  });

  test('announces when the API cannot reach the model server', async ({ page }) => {
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'The local LFM3-Omni server is not running.',
          },
        }),
      }),
    );

    await page.goto('/chat');
    await page.getByLabel('Message').fill('hello');
    await page.getByRole('button', { name: 'Send' }).click();

    // Next renders its own route announcer with role="alert"; scope to ours.
    const alert = page.locator('.alert[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('not running');
  });

  test('sends on Ctrl+Enter without submitting a half-typed newline', async ({ page }) => {
    await page.goto('/chat');
    const box = page.getByLabel('Message');
    await box.fill('hello there');
    await box.press('Control+Enter');

    await expect(page.getByText('Stub reply to', { exact: false })).toBeVisible();
    await expect(box).toHaveValue('');
  });
});
