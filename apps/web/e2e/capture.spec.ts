import { expect, test } from '@playwright/test';

/**
 * Chromium's fake capture devices stand in for a camera and a microphone, so
 * this exercises the real getUserMedia -> preview -> File path without hardware.
 */
test.use({
  permissions: ['camera', 'microphone'],
  launchOptions: {
    // Fake UI alone still prompts; the permission grant above and this pair
    // make the preview start without a human answering a prompt.
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

test.describe('media capture', () => {
  test('attaches a photo taken from the webcam preview', async ({ page }) => {
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Take photo' }).click();

    const dialog = page.getByRole('dialog', { name: 'Take a photo' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Camera preview')).toBeVisible();

    const shutter = dialog.getByRole('button', { name: 'Take photo' });
    await expect(shutter).toBeEnabled();
    await shutter.click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('.chat-attachments')).toContainText('Camera photo');
  });

  test('attaches a WAV clip recorded from the microphone', async ({ page }) => {
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Record audio' }).click();

    const dialog = page.getByRole('dialog', { name: 'Record audio' });
    const stop = dialog.getByRole('button', { name: 'Stop and attach' });
    await expect(stop).toBeEnabled({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await stop.click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('.chat-attachments')).toContainText('Microphone recording');
  });

  test('releases the camera when the dialog is cancelled', async ({ page }) => {
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Take photo' }).click();
    await expect(page.getByRole('dialog', { name: 'Take a photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('.chat-attachments')).toHaveCount(0);
    // Closing, rather than removing an open dialog, must hand focus back.
    await expect(page.getByRole('button', { name: 'Take photo' })).toBeFocused();
  });
});
