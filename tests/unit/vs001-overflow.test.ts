import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/model/types.js';
import type { BrowserSnapshot } from '../../src/rules/browser-snapshot.js';
import { evaluateVS001 } from '../../src/rules/vs001-overflow.js';

function rect(index = 0): Rect {
  return {
    x: index,
    y: index,
    width: 400,
    height: 20,
    top: index,
    right: index + 400,
    bottom: index + 20,
    left: index,
  };
}

function offender(index: number): { selector: string; rect: Rect } {
  return { selector: `#offender-${String(index)}`, rect: rect(index) };
}

function snapshotWithOverflow(
  overflow: Partial<BrowserSnapshot['overflow']> = {},
): BrowserSnapshot {
  return {
    overflow: {
      viewportWidth: 320,
      documentWidth: 480,
      offenders: [],
      ...overflow,
    },
    overlaps: [],
    images: [],
  };
}

describe('evaluateVS001', () => {
  it('emits the exact document finding and keeps the first ten offenders in order', () => {
    const offenders = Array.from({ length: 12 }, (_, index) => offender(index));

    expect(evaluateVS001(snapshotWithOverflow({ offenders }))).toEqual([
      {
        ruleId: 'VS001',
        severity: 'error',
        message: 'Document is 160px wider than the viewport',
        selector: 'html',
        evidence: {
          kind: 'overflow',
          viewportWidth: 320,
          documentWidth: 480,
          overflowPx: 160,
          offenders: offenders.slice(0, 10),
        },
        identity: ['html'],
      },
    ]);
  });

  it.each([
    ['no overflow', 320, 0],
    ['exactly one CSS pixel', 321, 0],
    ['more than one CSS pixel', 321.01, 1],
  ])('applies the raw tolerance for %s', (_label, documentWidth, count) => {
    expect(evaluateVS001(snapshotWithOverflow({ documentWidth }))).toHaveLength(
      count,
    );
  });

  it('rounds finding geometry after applying the threshold', () => {
    const fractionalOffender = {
      selector: '#fractional',
      rect: {
        x: -1.236,
        y: 2.345,
        width: 322.224,
        height: 10.005,
        top: 2.345,
        right: 320.988,
        bottom: 12.35,
        left: -1.236,
      },
    };

    expect(
      evaluateVS001(
        snapshotWithOverflow({
          viewportWidth: 320.004,
          documentWidth: 321.015,
          offenders: [fractionalOffender],
        }),
      ),
    ).toEqual([
      {
        ruleId: 'VS001',
        severity: 'error',
        message: 'Document is 1.01px wider than the viewport',
        selector: 'html',
        evidence: {
          kind: 'overflow',
          viewportWidth: 320,
          documentWidth: 321.02,
          overflowPx: 1.01,
          offenders: [
            {
              selector: '#fractional',
              rect: {
                x: -1.24,
                y: 2.35,
                width: 322.22,
                height: 10.01,
                top: 2.35,
                right: 320.99,
                bottom: 12.35,
                left: -1.24,
              },
            },
          ],
        },
        identity: ['html'],
      },
    ]);
  });

  it('does not mutate its snapshot input', () => {
    const snapshot = snapshotWithOverflow({
      offenders: [offender(0), offender(1)],
    });
    const before = structuredClone(snapshot);

    evaluateVS001(snapshot);

    expect(snapshot).toEqual(before);
  });
});
