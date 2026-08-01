import type { Browser, BrowserContext } from 'playwright';
import type { ViewportSpec } from '../model/types.js';

export function createAuditContext(
  browser: Browser,
  viewport: ViewportSpec,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    timezoneId: 'UTC',
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
}
