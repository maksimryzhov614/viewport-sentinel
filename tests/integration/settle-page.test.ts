import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../src/fixtures/server.js';
import { createAuditContext } from '../../src/runner/browser-context.js';
import {
  createReadinessDeadline,
  runReadinessStage,
  settlePage,
} from '../../src/runner/settle-page.js';
import type {
  NormalizedPageSpec,
  ViewportSpec,
} from '../../src/model/types.js';

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

function pageSpec(name: string, readySelector?: string): NormalizedPageSpec {
  const spec: NormalizedPageSpec = {
    name,
    url: `${baseUrl}/${name}`,
    consoleIgnore: [],
  };

  if (readySelector !== undefined) {
    spec.readySelector = readySelector;
  }

  return spec;
}

async function withPage(
  viewport: ViewportSpec,
  operation: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await createAuditContext(browser, viewport);
  try {
    await operation(await context.newPage());
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
  await expect(fetch(`${baseUrl}/clean`)).rejects.toThrow();
});

describe('fixture server', () => {
  it('serves only whitelisted files with deterministic response metadata', async () => {
    const clean = await fetch(`${baseUrl}/clean`);
    const svg = await fetch(`${baseUrl}/assets/valid.svg`);
    const unknown = await fetch(`${baseUrl}/%2e%2e/package.json`);

    expect(clean.status).toBe(200);
    expect(clean.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(clean.headers.get('cache-control')).toBe('no-store');
    expect(await clean.text()).toContain('id="clean-action"');
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
  });
});

describe('fixture pages', () => {
  it('settles the clean route with deterministic context settings', async () => {
    await withPage(MOBILE, async (page) => {
      await page.goto(`${baseUrl}/clean`, { waitUntil: 'domcontentloaded' });

      await expect(
        settlePage(page, pageSpec('clean'), createReadinessDeadline(10_000)),
      ).resolves.toBeUndefined();
      expect(
        await page.evaluate(() => [
          innerWidth,
          innerHeight,
          devicePixelRatio,
          navigator.language,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          matchMedia('(prefers-color-scheme: light)').matches,
          matchMedia('(prefers-reduced-motion: reduce)').matches,
        ]),
      ).toEqual([320, 844, 1, 'en-US', 'UTC', true, true]);
      expect(
        await page
          .locator('#clean-image')
          .evaluate((image: HTMLImageElement) => [
            image.complete,
            image.naturalWidth,
            image.naturalHeight,
          ]),
      ).toEqual([true, 120, 80]);
    });
  });

  it('keeps overflow fixture geometry exclusive to the mobile breakpoint', async () => {
    await withPage(MOBILE, async (page) => {
      await page.goto(`${baseUrl}/overflow`, {
        waitUntil: 'domcontentloaded',
      });
      await settlePage(
        page,
        pageSpec('overflow'),
        createReadinessDeadline(10_000),
      );

      expect(
        await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.querySelector('#overflow-offender')?.getBoundingClientRect()
            .width,
        ]),
      ).toEqual([480, 480]);
    });

    await withPage(DESKTOP, async (page) => {
      await page.goto(`${baseUrl}/overflow`, {
        waitUntil: 'domcontentloaded',
      });
      await settlePage(
        page,
        pageSpec('overflow'),
        createReadinessDeadline(10_000),
      );

      expect(
        await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.querySelector('#overflow-offender')?.getBoundingClientRect()
            .width,
        ]),
      ).toEqual([1440, 1440]);
    });
  });

  it('exposes the exact mobile overlap geometry and hides its cover on desktop', async () => {
    await withPage(MOBILE, async (page) => {
      await page.goto(`${baseUrl}/overlap`, { waitUntil: 'domcontentloaded' });
      await settlePage(
        page,
        pageSpec('overlap'),
        createReadinessDeadline(10_000),
      );

      expect(
        await page.evaluate(() => {
          const target = document.querySelector('#checkout');
          const cover = document.querySelector('#mobile-cover');
          if (
            !(target instanceof HTMLElement) ||
            !(cover instanceof HTMLElement)
          ) {
            throw new Error('Overlap fixture elements are missing');
          }
          const targetRect = target.getBoundingClientRect();
          const coverRect = cover.getBoundingClientRect();
          return {
            target: [
              targetRect.left,
              targetRect.top,
              targetRect.width,
              targetRect.height,
            ],
            cover: [
              coverRect.left,
              coverRect.top,
              coverRect.width,
              coverRect.height,
            ],
            centerId: document.elementFromPoint(160, 320)?.id,
            sampledId: document.elementFromPoint(160, 330)?.id,
          };
        }),
      ).toEqual({
        target: [60, 300, 200, 40],
        cover: [60, 322, 200, 18],
        centerId: 'checkout',
        sampledId: 'mobile-cover',
      });
    });

    await withPage(DESKTOP, async (page) => {
      await page.goto(`${baseUrl}/overlap`, { waitUntil: 'domcontentloaded' });

      expect(
        await page
          .locator('#mobile-cover')
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe('none');
    });
  });

  it('selects the missing WebP candidate at both fixture viewports', async () => {
    for (const viewport of [MOBILE, DESKTOP]) {
      await withPage(viewport, async (page) => {
        await page.goto(`${baseUrl}/picture`, {
          waitUntil: 'domcontentloaded',
        });

        expect(
          await page
            .locator('#product-image')
            .evaluate((image: HTMLImageElement) => ({
              currentSrc: image.currentSrc,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            })),
        ).toEqual({
          currentSrc: `${baseUrl}/assets/missing.webp`,
          naturalWidth: 0,
          naturalHeight: 0,
        });
      });
    }
  });

  it('emits the exact console fixture error once at both viewports', async () => {
    for (const viewport of [MOBILE, DESKTOP]) {
      await withPage(viewport, async (page) => {
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') {
            errors.push(message.text());
          }
        });

        await page.goto(`${baseUrl}/console`, {
          waitUntil: 'domcontentloaded',
        });

        expect(errors).toEqual(['viewport-sentinel fixture error']);
      });
    }
  });
});

describe('readiness deadline', () => {
  it('requires three stable animation-frame layout samples', async () => {
    await withPage(MOBILE, async (page) => {
      await page.setContent(`
        <style>
          html { scroll-behavior: smooth; }
          #probe {
            animation: pulse 1s infinite;
            caret-color: red;
            transition: width 1s;
          }
        </style>
        <input id="probe">
      `);
      await page.evaluate(() => {
        const widths = [320, 321, 322, 322, 322];
        let samples = 0;
        Object.defineProperty(document.documentElement, 'scrollWidth', {
          configurable: true,
          get() {
            const width = widths[Math.min(samples, widths.length - 1)];
            samples += 1;
            document.documentElement.dataset.layoutSamples = String(samples);
            return width;
          },
        });
      });

      await settlePage(
        page,
        {
          name: 'layout-probe',
          url: 'http://127.0.0.1/layout-probe',
          consoleIgnore: [],
        },
        createReadinessDeadline(1_000),
      );

      expect(
        await page.evaluate(() => {
          const probe = document.querySelector('#probe');
          if (!(probe instanceof HTMLElement)) {
            throw new Error('Layout probe is missing');
          }
          const style = getComputedStyle(probe);
          return {
            samples: Number(document.documentElement.dataset.layoutSamples),
            animation: style.animationName,
            transition: style.transitionDuration,
            caret: style.caretColor,
            scroll: getComputedStyle(document.documentElement).scrollBehavior,
          };
        }),
      ).toEqual({
        samples: 5,
        animation: 'none',
        transition: '0s',
        caret: 'rgba(0, 0, 0, 0)',
        scroll: 'auto',
      });
    });
  });

  it('attributes unstable layout exhaustion to layout', async () => {
    await withPage(MOBILE, async (page) => {
      await page.setContent('<main>Unstable layout probe</main>');
      await page.evaluate(() => {
        let width = 320;
        Object.defineProperty(document.documentElement, 'scrollWidth', {
          configurable: true,
          get() {
            width = width === 320 ? 321 : 320;
            return width;
          },
        });
      });

      await expect(
        settlePage(
          page,
          {
            name: 'unstable-layout',
            url: 'http://127.0.0.1/unstable-layout',
            consoleIgnore: [],
          },
          createReadinessDeadline(100),
        ),
      ).rejects.toMatchObject({
        name: 'ReadinessError',
        stage: 'layout',
      });
    });
  });

  it('is immutable and rejects an exhausted shared deadline before a later stage runs', async () => {
    await withPage(MOBILE, async (page) => {
      const deadline = createReadinessDeadline(30);
      await runReadinessStage('ready-selector', deadline, () =>
        Promise.resolve(undefined),
      );
      await page.waitForTimeout(50);
      let laterStageRan = false;

      expect(Object.isFrozen(deadline)).toBe(true);
      await expect(
        runReadinessStage('fonts', deadline, () => {
          laterStageRan = true;
          return Promise.resolve(undefined);
        }),
      ).rejects.toMatchObject({ name: 'ReadinessError', stage: 'fonts' });
      expect(laterStageRan).toBe(false);
    });
  });

  it('attributes a missing ready selector to ready-selector', async () => {
    await withPage(MOBILE, async (page) => {
      await page.goto(`${baseUrl}/timeout`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(
        settlePage(
          page,
          pageSpec('timeout', '#never'),
          createReadinessDeadline(1_000),
        ),
      ).rejects.toMatchObject({
        name: 'ReadinessError',
        stage: 'ready-selector',
      });
      expect(await page.locator('#never').count()).toBe(0);
    });
  });

  it('sanitizes readiness operation errors', async () => {
    await expect(
      runReadinessStage('navigation', createReadinessDeadline(1_000), () =>
        Promise.reject(
          new Error(
            'Navigation failed at https://user:pass@example.test/path?secret=yes#token',
          ),
        ),
      ),
    ).rejects.toMatchObject({
      name: 'ReadinessError',
      stage: 'navigation',
      message: 'Navigation failed at https://example.test/path',
    });
  });
});
