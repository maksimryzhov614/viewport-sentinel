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
import { evaluateVS002 } from '../../src/rules/vs002-overlap.js';
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
  return { name: 'vs002-test', url, consoleIgnore: [] };
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
    await page.setContent(html);
    await settlePage(
      page,
      pageSpec('about:blank'),
      createReadinessDeadline(10_000),
    );
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

describe('VS002 browser snapshot', () => {
  it('detects a fixed cover over a button center', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #target { position: absolute; left: 20px; top: 20px; width: 100px; height: 40px; }
        #cover { position: fixed; left: 20px; top: 20px; width: 100px; height: 40px; z-index: 1; }
      </style>
      <button id="target">Pay</button>
      <div id="cover"></div>
    `);

    expect(snapshot.overlaps).toHaveLength(1);
    expect(snapshot.overlaps[0]).toMatchObject({
      coverSelector: '#cover',
      targetSelector: '#target',
      overlapRatio: 1,
      centerCovered: true,
      sampledHit: true,
    });
    expect(evaluateVS002(snapshot)).toHaveLength(1);
  });

  it.each([
    ['24% overlap', 24, 0.24, false, 0],
    ['exactly 25% overlap', 25, 0.25, false, 0],
    ['more than 25% overlap', 26, 0.26, true, 1],
  ])(
    'applies the raw browser threshold for %s',
    async (_label, coverHeight, ratio, sampledHit, findingCount) => {
      const snapshot = await contentSnapshot(`
        <style>
          body { margin: 0; }
          #target { position: absolute; left: 20px; top: 20px; width: 100px; height: 100px; }
          #cover {
            position: fixed;
            left: 20px;
            top: ${String(120 - coverHeight)}px;
            width: 100px;
            height: ${String(coverHeight)}px;
            z-index: 1;
          }
        </style>
        <button id="target">Pay</button>
        <div id="cover"></div>
      `);

      expect(snapshot.overlaps).toHaveLength(1);
      expect(snapshot.overlaps[0]).toMatchObject({
        overlapRatio: ratio,
        centerCovered: false,
        sampledHit,
      });
      expect(evaluateVS002(snapshot)).toHaveLength(findingCount);
    },
  );

  it('does not emit a 30% candidate behind the button', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #cover { position: fixed; left: 20px; top: 90px; width: 100px; height: 30px; z-index: 1; }
        #target { position: relative; z-index: 2; margin: 20px; width: 100px; height: 100px; }
      </style>
      <div id="cover"></div>
      <button id="target">Pay</button>
    `);

    expect(snapshot.overlaps).toHaveLength(1);
    expect(snapshot.overlaps[0]).toMatchObject({
      overlapRatio: 0.3,
      centerCovered: false,
      sampledHit: false,
    });
    expect(evaluateVS002(snapshot)).toEqual([]);
  });

  it('gives the target family precedence at the center', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #target { position: absolute; left: 20px; top: 20px; width: 100px; height: 100px; padding: 0; }
        #target-center {
          position: absolute;
          left: 40px;
          top: 40px;
          width: 20px;
          height: 20px;
          z-index: 3;
        }
        #cover { position: fixed; left: 20px; top: 20px; width: 100px; height: 100px; z-index: 2; }
      </style>
      <button id="target"><span id="target-center">Pay</span></button>
      <div id="cover"></div>
    `);

    expect(snapshot.overlaps).toHaveLength(1);
    expect(snapshot.overlaps[0]).toMatchObject({
      centerCovered: false,
      sampledHit: true,
    });
  });

  it('accepts a descendant of the cover returned by elementFromPoint', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #target { position: absolute; left: 20px; top: 20px; width: 100px; height: 40px; }
        #cover { position: fixed; left: 20px; top: 20px; width: 100px; height: 40px; z-index: 1; }
        #cover-child { width: 100%; height: 100%; }
      </style>
      <button id="target">Pay</button>
      <div id="cover"><span id="cover-child"></span></div>
    `);

    expect(snapshot.overlaps).toHaveLength(1);
    expect(snapshot.overlaps[0]).toMatchObject({
      coverSelector: '#cover',
      centerCovered: true,
      sampledHit: true,
    });
  });

  it('uses the nine 25%, 50%, and 75% intersection grid points', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #target { position: absolute; left: 20px; top: 20px; width: 100px; height: 100px; }
        #cover { position: fixed; left: 20px; top: 80px; width: 100px; height: 40px; z-index: 2; }
        .blocker { position: absolute; z-index: 3; }
        #block-top { left: 20px; top: 80px; width: 100px; height: 29px; }
        #block-bottom { left: 20px; top: 111px; width: 100px; height: 9px; }
        #block-left { left: 20px; top: 109px; width: 74px; height: 2px; }
        #block-right { left: 96px; top: 109px; width: 24px; height: 2px; }
      </style>
      <button id="target">Pay</button>
      <div id="cover"></div>
      <i id="block-top" class="blocker"></i>
      <i id="block-bottom" class="blocker"></i>
      <i id="block-left" class="blocker"></i>
      <i id="block-right" class="blocker"></i>
    `);

    expect(snapshot.overlaps).toHaveLength(1);
    expect(snapshot.overlaps[0]).toMatchObject({
      overlapRatio: 0.4,
      centerCovered: false,
      sampledHit: true,
    });
  });

  it('applies all bidirectional containment exclusions', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        .fixed { position: fixed; left: 10px; width: 100px; height: 30px; }
      </style>
      <button id="same" class="fixed" style="top:10px">Same</button>
      <div id="parent-cover" class="fixed" style="top:50px"><button id="child-target">Child</button></div>
      <button id="parent-target" style="position:absolute;left:10px;top:90px;width:100px;height:30px">
        Parent <span id="child-cover" class="fixed" style="top:90px"></span>
      </button>
    `);

    expect(snapshot.overlaps).toEqual([]);
    expect(evaluateVS002(snapshot)).toEqual([]);
  });

  it('deduplicates targets matching multiple selector branches by element identity', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #target { position: absolute; left: 20px; top: 20px; width: 100px; height: 40px; }
        #cover { position: fixed; left: 20px; top: 20px; width: 100px; height: 40px; z-index: 1; }
      </style>
      <button id="target" role="button" tabindex="0">Pay</button>
      <div id="cover"></div>
    `);

    expect(snapshot.overlaps).toHaveLength(1);
    expect(snapshot.overlaps[0]?.targetSelector).toBe('#target');
  });

  it('excludes non-actionable and non-visible targets', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #cover { position: fixed; inset: 0; z-index: 10; }
        .target { display: block; width: 20px; height: 20px; }
        #pointer-none { pointer-events: none; }
        #opacity-target { opacity: 0.1; }
        #opacity-target > button { opacity: 0.1; }
        #fully-clipped { width: 20px; height: 0; overflow: hidden; }
        #zero-size { width: 0; height: 0; padding: 0; border: 0; }
      </style>
      <div id="cover"></div>
      <button id="aria-disabled" class="target" aria-disabled="  TrUe  ">Aria</button>
      <button id="disabled" class="target" disabled>Disabled</button>
      <div inert><button id="inert-target" class="target">Inert</button></div>
      <button id="pointer-none" class="target">Pointer</button>
      <div id="opacity-target"><button class="target">Opacity</button></div>
      <div id="fully-clipped"><button class="target">Clipped</button></div>
      <button id="zero-size">Zero</button>
      <input id="hidden-input" type="hidden">
      <div id="negative-tabindex" class="target" tabindex="-1">Skip</div>
    `);

    expect(snapshot.overlaps).toEqual([]);
  });

  it('excludes covers at the effective opacity boundary and with disabled pointer events', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #target { position: absolute; left: 20px; top: 20px; width: 100px; height: 40px; }
        .cover { position: fixed; left: 20px; top: 20px; width: 100px; height: 40px; z-index: 2; }
        #opacity-parent { opacity: 0.1; }
        #opacity-cover { opacity: 0.1; }
        #pointer-cover { pointer-events: none; }
      </style>
      <button id="target">Pay</button>
      <div id="opacity-parent"><div id="opacity-cover" class="cover"></div></div>
      <div id="pointer-cover" class="cover"></div>
    `);

    expect(snapshot.overlaps).toEqual([]);
  });

  it('keeps a normal sticky header in flow above the button from becoming a finding', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #sticky { position: sticky; top: 0; height: 40px; }
        #target { display: block; margin-top: 40px; width: 100px; height: 40px; }
      </style>
      <header id="sticky"></header>
      <button id="target">Pay</button>
    `);

    expect(snapshot.overlaps).toEqual([]);
    expect(evaluateVS002(snapshot)).toEqual([]);
  });

  it.each([
    ['viewport-fixed', 'position: fixed', '', true],
    ['transformed-fixed', 'position: fixed', 'transform: translateZ(0)', false],
    ['initial-absolute', 'position: absolute', '', true],
    ['container-absolute', 'position: absolute', 'position: relative', false],
  ])(
    'preserves actual clipping ancestry for a %s actionable',
    async (_name, targetPosition, containerPosition, intersectsCover) => {
      const snapshot = await contentSnapshot(`
        <style>
          body { margin: 0; }
          #clip {
            width: 100px;
            height: 40px;
            overflow: hidden;
            ${containerPosition};
          }
          #target {
            ${targetPosition};
            left: 0;
            top: 0;
            width: 400px;
            height: 40px;
          }
          #cover {
            position: fixed;
            left: 150px;
            top: 0;
            width: 50px;
            height: 40px;
            z-index: 3;
          }
        </style>
        <div id="clip"><button id="target">Wide target</button></div>
        <div id="cover"></div>
      `);

      expect(
        snapshot.overlaps.some(
          ({ coverSelector, targetSelector }) =>
            coverSelector === '#cover' && targetSelector === '#target',
        ),
      ).toBe(intersectsCover);
    },
  );

  it('preserves cover order then target document order', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        .target { position: absolute; left: 20px; width: 100px; height: 40px; }
        .cover { position: fixed; left: 20px; top: 20px; width: 100px; height: 100px; }
      </style>
      <button id="target-a" class="target" style="top:20px">A</button>
      <button id="target-b" class="target" style="top:70px">B</button>
      <div id="cover-a" class="cover"></div>
      <div id="cover-b" class="cover"></div>
    `);

    expect(
      snapshot.overlaps.map(({ coverSelector, targetSelector }) => [
        coverSelector,
        targetSelector,
      ]),
    ).toEqual([
      ['#cover-a', '#target-a'],
      ['#cover-a', '#target-b'],
      ['#cover-b', '#target-a'],
      ['#cover-b', '#target-b'],
    ]);
  });

  it('keeps sub-one-square-pixel clipped targets out of viewport-visible actionables', async () => {
    const snapshot = await contentSnapshot(`
      <style>
        body { margin: 0; }
        #clip { width: 0.5px; height: 1px; overflow: hidden; }
        #target { width: 20px; height: 20px; padding: 0; }
        #cover { position: fixed; inset: 0; z-index: 2; }
      </style>
      <div id="clip"><button id="target">Tiny</button></div>
      <div id="cover"></div>
    `);

    expect(snapshot.overlaps).toEqual([]);
  });

  it.each([
    ['mobile-320', MOBILE, ['VS002']],
    ['desktop-1440', DESKTOP, []],
  ])(
    'audits the real /overlap fixture at %s',
    async (_name, viewport, ruleIds) => {
      const snapshot = await settledSnapshot('/overlap', viewport);

      expect(evaluateVS002(snapshot).map(({ ruleId }) => ruleId)).toEqual(
        ruleIds,
      );
    },
  );
});
