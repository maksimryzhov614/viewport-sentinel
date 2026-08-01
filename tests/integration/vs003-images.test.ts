import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../src/fixtures/server.js';
import { canonicalStringify } from '../../src/core/canonical.js';
import { materializeFinding } from '../../src/core/findings.js';
import type {
  AuditResult,
  NormalizedPageSpec,
  ViewportSpec,
} from '../../src/model/types.js';
import { toSarif } from '../../src/reporters/sarif.js';
import { captureBrowserSnapshot } from '../../src/rules/browser-snapshot.js';
import { evaluateVS001 } from '../../src/rules/vs001-overflow.js';
import { evaluateVS002 } from '../../src/rules/vs002-overlap.js';
import { evaluateVS003 } from '../../src/rules/vs003-images.js';
import { createAuditContext } from '../../src/runner/browser-context.js';
import {
  createReadinessDeadline,
  settlePage,
} from '../../src/runner/settle-page.js';

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

const VALID_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3C/svg%3E";

let browser: Browser;
let fixture: FixtureServer;
let baseUrl: string;

function pageSpec(url: string): NormalizedPageSpec {
  return { name: 'vs003-test', url, consoleIgnore: [] };
}

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

async function contentSnapshot(
  html: string,
  viewport: ViewportSpec = MOBILE,
): ReturnType<typeof captureBrowserSnapshot> {
  return withPage(viewport, async (page) => {
    await page.setContent(html, { waitUntil: 'load' });
    return captureBrowserSnapshot(page);
  });
}

async function settledSnapshot(
  route: string,
  viewport: ViewportSpec,
): ReturnType<typeof captureBrowserSnapshot> {
  return withPage(viewport, async (page) => {
    const url = `${baseUrl}${route}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await settlePage(page, pageSpec(url), createReadinessDeadline(10_000));
    return captureBrowserSnapshot(page);
  });
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

describe('VS003 browser snapshot', () => {
  it.each([MOBILE, DESKTOP])(
    'reports the browser-selected missing picture once at $name without VS001/VS002 spillover',
    async (viewport) => {
      const snapshot = await settledSnapshot('/picture', viewport);
      const findings = evaluateVS003(snapshot);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: 'VS003',
        selector: '#product-image',
      });
      const evidence = findings[0]?.evidence;
      expect(evidence?.kind).toBe('image');
      if (evidence?.kind !== 'image') {
        throw new Error('Expected VS003 image evidence');
      }
      expect(evidence.currentSrc).toMatch(/\/assets\/missing\.webp$/u);
      expect(evaluateVS001(snapshot)).toEqual([]);
      expect(evaluateVS002(snapshot)).toEqual([]);
    },
  );

  it.each([MOBILE, DESKTOP])(
    'keeps the clean image clean at $name',
    async (viewport) => {
      const snapshot = await settledSnapshot('/clean', viewport);

      expect(evaluateVS003(snapshot)).toEqual([]);
    },
  );

  it('excludes non-rendered and below-fold lazy images but includes below-fold eager images', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        img { display: block; width: 20px; height: 20px; }
        #display-none { display: none; }
        #zero-size { width: 0; height: 0; }
        #content-hidden-parent { content-visibility: hidden; }
        .below-fold { position: absolute; top: 900px; }
      </style>
      <img id="visible" src="${VALID_IMAGE}" alt="">
      <img id="hidden-attribute" src="${VALID_IMAGE}" hidden alt="">
      <img id="display-none" src="${VALID_IMAGE}" alt="">
      <img id="zero-size" src="${VALID_IMAGE}" alt="">
      <div id="content-hidden-parent"><img id="content-hidden" src="${VALID_IMAGE}" alt=""></div>
      <img id="lazy-below" class="below-fold" loading="lazy" src="${VALID_IMAGE}" alt="">
      <img id="eager-below" class="below-fold" loading="eager" src="${VALID_IMAGE}" alt="">
    `);

    expect(snapshot.images.map(({ selector }) => selector)).toEqual([
      '#visible',
      '#eager-below',
    ]);
  });

  it('uses the clipped viewport boundary for lazy image scope', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        img { position: absolute; width: 20px; height: 2px; }
        #crosses-boundary { top: 843px; }
        #starts-at-boundary { top: 844px; }
      </style>
      <img id="crosses-boundary" loading="lazy" src="${VALID_IMAGE}" alt="">
      <img id="starts-at-boundary" loading="lazy" src="${VALID_IMAGE}" alt="">
    `);

    expect(snapshot.images.map(({ selector }) => selector)).toEqual([
      '#crosses-boundary',
    ]);
  });

  it('applies the effective opacity greater-than boundary', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        img { display: block; width: 20px; height: 20px; }
        #at-boundary, #above-boundary { opacity: 0.1; }
        #at-boundary > img { opacity: 0.1; }
        #above-boundary > img { opacity: 0.101; }
      </style>
      <div id="at-boundary"><img id="opacity-excluded" src="${VALID_IMAGE}" alt=""></div>
      <div id="above-boundary"><img id="opacity-included" src="${VALID_IMAGE}" alt=""></div>
    `);

    expect(snapshot.images.map(({ selector }) => selector)).toEqual([
      '#opacity-included',
    ]);
  });

  it('captures only light-DOM images with the exact candidate attributes', async () => {
    const snapshot = await withPage(MOBILE, async (page) => {
      await page.setContent(`
        <style>img { display: block; width: 20px; height: 20px; }</style>
        <img id="no-candidate" alt="">
        <img id="src-candidate" src="${VALID_IMAGE}" alt="">
        <img id="srcset-candidate" srcset="${VALID_IMAGE} 1x" alt="">
        <picture>
          <source srcset="${VALID_IMAGE} 1x">
          <img id="picture-source-candidate" alt="">
        </picture>
        <div id="shadow-host"></div>
      `);
      await page.evaluate((validImage) => {
        const host = document.querySelector('#shadow-host');
        const root = host?.attachShadow({ mode: 'open' });
        if (root !== undefined) {
          root.innerHTML = `<img id="shadow-image" src="${validImage}" style="width:20px;height:20px">`;
        }
      }, VALID_IMAGE);
      return captureBrowserSnapshot(page);
    });

    expect(snapshot.images.map(({ selector }) => selector)).toEqual([
      '#src-candidate',
      '#srcset-candidate',
      '#picture-source-candidate',
    ]);
  });

  it('resolves and sanitizes picture and img candidates while preserving source and descriptor order', async () => {
    const snapshot = await withPage(MOBILE, async (page) => {
      await page.goto(`${baseUrl}/clean`, { waitUntil: 'load' });
      const credentialedBaseUrl = baseUrl.replace(
        'http://',
        'http://alice:secret@',
      );
      await page.setContent(`
        <style>body { margin: 0; } img { width: 120px; height: 80px; }</style>
        <picture>
          <source media="(min-width: 9999px)" srcset="/assets/valid.svg?first=secret#one 1x, ${credentialedBaseUrl}/assets/valid.svg?second=secret#two 2x">
          <source media="(min-width: 9998px)" srcset="relative-wide.svg?third=secret#three 320w, /assets/valid.svg?fourth=secret#four 640w">
          <img id="ordered-candidates"
            srcset="/assets/valid.svg?fifth=secret#five 1x, /assets/valid.svg?sixth=secret#six 2x"
            src="/assets/valid.svg?fallback=secret#fallback"
            alt="">
        </picture>
      `);
      return captureBrowserSnapshot(page);
    });

    expect(snapshot.images).toHaveLength(1);
    expect(snapshot.images[0]).toMatchObject({
      selector: '#ordered-candidates',
      currentSrc: `${baseUrl}/assets/valid.svg`,
      sourceCandidates: [
        `${baseUrl}/assets/valid.svg 1x`,
        `${baseUrl}/assets/valid.svg 2x`,
        `${baseUrl}/relative-wide.svg 320w`,
        `${baseUrl}/assets/valid.svg 640w`,
        `${baseUrl}/assets/valid.svg 1x`,
        `${baseUrl}/assets/valid.svg 2x`,
        `${baseUrl}/assets/valid.svg`,
      ],
    });
    expect(JSON.stringify(snapshot.images[0])).not.toMatch(
      /alice|secret|first|second|third|fourth|fifth|sixth|fallback|#one/u,
    );
  });

  it('redacts non-HTTP(S) image payloads from the snapshot through final JSON and SARIF', async () => {
    const snapshot = await contentSnapshot(`
      <style>body { margin: 0; } img { display: block; width: 20px; height: 20px; }</style>
      <img id="data-inline" src="data:image/png;base64,VS003_DATA_SECRET" alt="">
      <img id="javascript-inline" src="javascript:VS003_JAVASCRIPT_SECRET" alt="">
      <img id="blob-inline" src="blob:https://example.test/VS003_BLOB_SECRET" alt="">
    `);
    const drafts = evaluateVS003(snapshot);

    expect(
      snapshot.images.map(({ selector, currentSrc, sourceCandidates }) => ({
        selector,
        currentSrc,
        sourceCandidates,
      })),
    ).toEqual([
      {
        selector: '#data-inline',
        currentSrc: '<inline>',
        sourceCandidates: ['<inline>'],
      },
      {
        selector: '#javascript-inline',
        currentSrc: '<inline>',
        sourceCandidates: ['<inline>'],
      },
      {
        selector: '#blob-inline',
        currentSrc: '<inline>',
        sourceCandidates: ['<inline>'],
      },
    ]);
    expect(drafts).toHaveLength(3);
    expect(JSON.stringify(drafts)).not.toMatch(
      /VS003_(?:DATA|JAVASCRIPT|BLOB)_SECRET|data:image|javascript:|blob:/u,
    );

    const auditedUrl = `${baseUrl}/inline-sources`;
    const page = pageSpec(auditedUrl);
    const findings = drafts.map((draft) =>
      materializeFinding(
        { page, viewport: MOBILE, sanitizedUrl: auditedUrl },
        draft,
      ),
    );
    const result: AuditResult = {
      schemaVersion: 1,
      complete: true,
      tool: { name: 'viewport-sentinel', version: '0.1.0' },
      browser: {
        name: 'chromium',
        playwrightVersion: '1.62.1',
        version: browser.version(),
      },
      config: {
        version: 1,
        pages: [
          {
            name: page.name,
            url: auditedUrl,
            hasReadySelector: false,
            consoleIgnoreCount: 0,
          },
        ],
        viewports: [MOBILE],
        timeoutMs: 10_000,
        formats: ['json', 'sarif'],
      },
      combinations: { total: 1, completed: 1, failedReadiness: 0 },
      totals: {
        findingCount: findings.length,
        suppressedConsoleCount: 0,
        omittedFindingCount: 0,
        omittedByCombination: [],
      },
      findings,
    };
    const reports = [
      canonicalStringify(result),
      canonicalStringify(toSarif(result, 'viewport-sentinel.config.json')),
    ];

    for (const report of reports) {
      expect(report).toContain('"<inline>"');
      expect(report).not.toMatch(
        /VS003_(?:DATA|JAVASCRIPT|BLOB)_SECRET|data:image|javascript:|blob:/u,
      );
    }
  });

  it('starts all decodes together and records mixed outcomes in document order after one shared window', async () => {
    await withPage(MOBILE, async (page) => {
      await page.setContent(`
        <style>img { display: block; width: 20px; height: 20px; }</style>
        <img id="pending-first" src="${VALID_IMAGE}" alt="">
        <img id="resolved" src="${VALID_IMAGE}" alt="">
        <img id="rejected" src="${VALID_IMAGE}" alt="">
        <img id="pending-last" src="${VALID_IMAGE}" alt="">
      `);
      await page.waitForFunction(() =>
        [...document.images].every(
          (image) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        ),
      );
      await page.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          decodeStarts: { id: string; at: number }[];
        };
        state.decodeStarts = [];
        HTMLImageElement.prototype.decode = function decode(
          this: HTMLImageElement,
        ): Promise<void> {
          state.decodeStarts.push({ id: this.id, at: performance.now() });
          if (this.id === 'resolved') {
            return Promise.resolve();
          }
          if (this.id === 'rejected') {
            return Promise.reject(new Error('decode rejected'));
          }
          return new Promise<void>(() => undefined);
        };
      });

      const startedAt = performance.now();
      const snapshot = await captureBrowserSnapshot(page);
      const durationMs = performance.now() - startedAt;
      const decodeStarts = await page.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          decodeStarts: { id: string; at: number }[];
        };
        return state.decodeStarts;
      });

      expect(
        snapshot.images.map(({ selector, decode }) => [selector, decode]),
      ).toEqual([
        ['#pending-first', 'timeout'],
        ['#resolved', 'resolved'],
        ['#rejected', 'rejected'],
        ['#pending-last', 'timeout'],
      ]);
      expect(decodeStarts.map(({ id }) => id)).toEqual([
        'pending-first',
        'resolved',
        'rejected',
        'pending-last',
      ]);
      expect(
        Math.max(...decodeStarts.map(({ at }) => at)) -
          Math.min(...decodeStarts.map(({ at }) => at)),
      ).toBeLessThan(100);
      expect(durationMs).toBeGreaterThanOrEqual(1_800);
      expect(durationMs).toBeLessThan(3_500);
      expect(evaluateVS003(snapshot).map(({ selector }) => selector)).toEqual([
        '#rejected',
      ]);
    });
  }, 10_000);
});
