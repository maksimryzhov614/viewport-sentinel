import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../fixtures/server.js';
import type { ViewportSpec } from '../../src/model/types.js';
import { attachConsoleCapture } from '../../src/runner/console-events.js';
import { createAuditContext } from '../../src/runner/browser-context.js';
import { evaluateVS004 } from '../../src/rules/vs004-console.js';

const MOBILE: ViewportSpec = {
  name: 'mobile-320',
  width: 320,
  height: 844,
  deviceScaleFactor: 1,
};

const DESKTOP: ViewportSpec = {
  name: 'desktop-1440',
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
};

let browser: Browser;
let fixture: FixtureServer;
let baseUrl: string;

async function withPage<T>(
  viewport: ViewportSpec,
  operation: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await createAuditContext(browser, viewport);
  try {
    return await operation(await context.newPage());
  } finally {
    await context.close();
  }
}

beforeAll(async () => {
  fixture = await startFixtureServer(0);
  baseUrl = fixture.url;
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser.close();
  await fixture.close();
});

describe('VS004 browser console capture', () => {
  it.each([MOBILE, DESKTOP])(
    'captures the navigation-time console API error once at $name',
    async (viewport) => {
      await withPage(viewport, async (page) => {
        const capture = attachConsoleCapture(page);

        await page.goto(`${baseUrl}/console`, { waitUntil: 'load' });
        capture.stop();
        const result = evaluateVS004(capture.events(), []);

        expect(result.suppressedCount).toBe(0);
        expect(result.drafts).toHaveLength(1);
        expect(result.drafts[0]).toMatchObject({
          ruleId: 'VS004',
          message: 'viewport-sentinel fixture error',
          evidence: {
            kind: 'console',
            eventType: 'console.error',
            message: 'viewport-sentinel fixture error',
            sourceUrl: `${baseUrl}/console`,
            line: 16,
            column: 14,
          },
          identity: [
            'console.error',
            'viewport-sentinel fixture error',
            `${baseUrl}/console`,
            16,
            14,
          ],
        });
      });
    },
  );

  it.each([MOBILE, DESKTOP])(
    'excludes the browser-generated missing picture request at $name',
    async (viewport) => {
      await withPage(viewport, async (page) => {
        const capture = attachConsoleCapture(page);

        await page.goto(`${baseUrl}/picture`, { waitUntil: 'load' });
        capture.stop();

        expect(capture.events()).toEqual([]);
        expect(evaluateVS004(capture.events(), [])).toEqual({
          drafts: [],
          suppressedCount: 0,
        });
      });
    },
  );

  it('captures an uncaught inline error without serializing its stack', async () => {
    await withPage(MOBILE, async (page) => {
      const capture = attachConsoleCapture(page);

      await page.setContent(
        '<script>throw new Error("uncaught fixture error")</script>',
        { waitUntil: 'load' },
      );
      capture.stop();
      const result = evaluateVS004(capture.events(), []);

      expect(result.drafts).toHaveLength(1);
      expect(result.drafts[0]).toMatchObject({
        message: 'uncaught fixture error',
        evidence: {
          kind: 'console',
          eventType: 'pageerror',
          message: 'uncaught fixture error',
          sourceUrl: '<inline>',
          line: 0,
          column: 0,
        },
        identity: ['pageerror', 'uncaught fixture error', '<inline>', 0, 0],
      });
      expect(JSON.stringify(capture.events())).not.toContain('at <anonymous>');
    });
  });
});
