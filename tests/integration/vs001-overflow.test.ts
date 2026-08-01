import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../fixtures/server.js';
import type {
  NormalizedPageSpec,
  ViewportSpec,
} from '../../src/model/types.js';
import { captureBrowserSnapshot } from '../../src/rules/browser-snapshot.js';
import { evaluateVS001 } from '../../src/rules/vs001-overflow.js';
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

let browser: Browser;
let fixture: FixtureServer;
let baseUrl: string;

function pageSpec(url: string): NormalizedPageSpec {
  return { name: 'vs001-test', url, consoleIgnore: [] };
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

async function contentSnapshot(
  html: string,
): ReturnType<typeof captureBrowserSnapshot> {
  return withPage(MOBILE, async (page) => {
    await page.setContent(html);
    await settlePage(
      page,
      pageSpec('about:blank'),
      createReadinessDeadline(10_000),
    );
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

describe('VS001 browser snapshot', () => {
  it.each([
    ['mobile-320', MOBILE, 1],
    ['desktop-1440', DESKTOP, 0],
  ])(
    'audits the real /overflow fixture at %s',
    async (_name, viewport, count) => {
      const snapshot = await settledSnapshot('/overflow', viewport);

      expect(evaluateVS001(snapshot)).toHaveLength(count);
      if (count === 1) {
        expect(snapshot).toEqual({
          overflow: {
            viewportWidth: 320,
            documentWidth: 480,
            offenders: [
              {
                selector: '#overflow-offender',
                rect: {
                  x: 0,
                  y: 0,
                  width: 480,
                  height: 40,
                  top: 0,
                  right: 480,
                  bottom: 40,
                  left: 0,
                },
              },
            ],
          },
          overlaps: [],
          images: [],
        });
      }
    },
  );

  it.each([
    ['mobile-320', MOBILE],
    ['desktop-1440', DESKTOP],
  ])('does not flag the real /clean fixture at %s', async (_name, viewport) => {
    expect(evaluateVS001(await settledSnapshot('/clean', viewport))).toEqual(
      [],
    );
  });

  it('detects left and right escape beyond one pixel but accepts the exact boundaries', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        .probe { position: absolute; width: 1px; height: 10px; }
        #left-one { left: -1px; }
        #left-over { left: -1.02px; }
        #right-one { left: 320px; }
        #right-over { left: 320px; width: 1.02px; }
        #document-overflow { width: 322px; height: 10px; }
      </style>
      <div id="left-one" class="probe"></div>
      <div id="left-over" class="probe"></div>
      <div id="right-one" class="probe"></div>
      <div id="right-over" class="probe"></div>
      <div id="document-overflow"></div>
    `);

    expect(snapshot.overflow.offenders.map(({ selector }) => selector)).toEqual(
      ['#left-over', '#right-over', '#document-overflow'],
    );
  });

  it('excludes wide content contained by a non-escaping overflow:auto ancestor', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #real-offender { width: 400px; height: 10px; }
        #scroller { width: 200px; overflow-x: auto; }
        #scrolled-content { width: 500px; height: 10px; }
      </style>
      <div id="real-offender"></div>
      <div id="scroller"><div id="scrolled-content"></div></div>
    `);

    expect(snapshot.overflow.documentWidth).toBe(400);
    expect(snapshot.overflow.offenders).toHaveLength(1);
    expect(snapshot.overflow.offenders[0]?.selector).toBe('#real-offender');
  });

  it.each([
    ['viewport-fixed', 'position: fixed', '', true],
    ['transformed-fixed', 'position: fixed', 'transform: translateZ(0)', false],
    ['initial-absolute', 'position: absolute', '', true],
    ['container-absolute', 'position: absolute', 'position: relative', false],
  ])(
    'uses the actual clipping ancestry for a %s descendant',
    async (_name, targetPosition, containerPosition, expectedOffender) => {
      const snapshot = await contentSnapshot(`
        <style>
          body { margin: 0; }
          #clip {
            width: 100px;
            height: 100px;
            overflow: hidden;
            ${containerPosition};
          }
          #positioned-offender {
            ${targetPosition};
            left: 0;
            top: 0;
            width: 400px;
            height: 10px;
          }
          #document-overflow { width: 400px; height: 10px; }
        </style>
        <div id="clip"><div id="positioned-offender"></div></div>
        <div id="document-overflow"></div>
      `);

      expect(
        snapshot.overflow.offenders.map(({ selector }) => selector),
      ).toEqual(
        expectedOffender
          ? ['#positioned-offender', '#document-overflow']
          : ['#document-overflow'],
      );
    },
  );

  it('keeps only rendered offenders from the light DOM', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        .wide { width: 500px; height: 10px; }
        #display-none { display: none; }
        #visibility-hidden { visibility: hidden; }
        #zero-height { height: 0; }
      </style>
      <div id="real-offender" class="wide"></div>
      <div id="display-none" class="wide"></div>
      <div id="visibility-hidden" class="wide"></div>
      <div id="hidden-attribute" class="wide" hidden></div>
      <div id="zero-height" class="wide"></div>
      <div id="shadow-host"></div>
      <script>
        const host = document.querySelector('#shadow-host');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<div id="shadow-offender" style="width:600px;height:10px"></div>';
      </script>
    `);

    expect(snapshot.overflow.offenders.map(({ selector }) => selector)).toEqual(
      ['#real-offender'],
    );
  });

  it('uses diagnostic selector precedence, escaping, and six-segment truncation', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        .wide { width: 400px; height: 10px; }
      </style>
      <div id="ignored" data-testid='quote"value' data-test="unused" class="wide"></div>
      <div data-testid="shared" data-test="unique-test" class="wide"></div>
      <div data-testid="shared"></div>
      <div data-testid="shared-qa" data-test="shared-test" data-qa="unique-qa" class="wide"></div>
      <div data-testid="shared-qa" data-test="shared-test"></div>
      <div id="offer:wide" class="wide"></div>
      <section><section><section><section><section><section><section>
        <div class="wide"></div>
      </section></section></section></section></section></section></section>
    `);

    expect(snapshot.overflow.offenders.map(({ selector }) => selector)).toEqual(
      [
        '[data-testid="quote\\"value"]',
        '[data-test="unique-test"]',
        '[data-qa="unique-qa"]',
        '#offer\\:wide',
        '<truncated> > section:nth-of-type(1) > section:nth-of-type(1) > section:nth-of-type(1) > section:nth-of-type(1) > section:nth-of-type(1) > div:nth-of-type(1)',
      ],
    );
  });

  it('caps browser evidence at the first ten offenders in document order', async () => {
    const elements = Array.from(
      { length: 12 },
      (_, index) => `<div id="offender-${String(index)}"></div>`,
    ).join('');
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        div { width: 400px; height: 10px; }
      </style>
      ${elements}
    `);

    expect(snapshot.overflow.offenders.map(({ selector }) => selector)).toEqual(
      Array.from({ length: 10 }, (_, index) => `#offender-${String(index)}`),
    );
  });

  it('normalizes fractional browser rectangles to two decimals after evaluation', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #fractional {
          position: absolute;
          left: 0.125px;
          top: 1.125px;
          width: 400.125px;
          height: 10.125px;
        }
      </style>
      <div id="fractional"></div>
    `);

    expect(snapshot.overflow.offenders).toEqual([
      {
        selector: '#fractional',
        rect: {
          x: 0.13,
          y: 1.13,
          width: 400.13,
          height: 10.13,
          top: 1.13,
          right: 400.25,
          bottom: 11.25,
          left: 0.13,
        },
      },
    ]);
  });
});
