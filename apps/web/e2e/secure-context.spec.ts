import { networkInterfaces } from 'node:os';

import { expect, test } from '@playwright/test';

/**
 * A phone reaches this app by its LAN address, not `localhost`, and that origin
 * is not secure, so the browser hides `getUserMedia`. This has to be asserted
 * through a real non-loopback origin: the unit suite can only prove the string
 * rules, not that the page consults them.
 */
const WEB_PORT = 3100;

function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      return address.address;
    }
  }
  return null;
}

const address = lanAddress();

test.describe('secure context', () => {
  test.skip(address === null, 'no non-loopback IPv4 address to serve from');

  test('asks for HTTPS on a plain-HTTP LAN origin', async ({ page }) => {
    await page.goto(`http://${address}:${WEB_PORT}/chat`);

    const notice = page.locator('.chat-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`http://${address}:${WEB_PORT}`);
    await expect(notice).toContainText('https-cert.ps1');

    // The fact that capture is actually unavailable is the point of the notice;
    // asserting it keeps this from passing on an origin that quietly has media.
    const hasMediaDevices = await page.evaluate(() => 'mediaDevices' in navigator);
    expect(hasMediaDevices).toBe(false);
  });

  test('stays quiet over HTTPS or loopback', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();
    await expect(page.locator('.chat-notice')).toHaveCount(0);
  });
});
