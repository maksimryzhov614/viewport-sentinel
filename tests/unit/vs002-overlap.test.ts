import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/model/types.js';
import type {
  BrowserSnapshot,
  OverlapSnapshot,
} from '../../src/rules/browser-snapshot.js';
import { evaluateVS002 } from '../../src/rules/vs002-overlap.js';

function rect(overrides: Partial<Rect> = {}): Rect {
  return {
    x: 10,
    y: 20,
    width: 100,
    height: 40,
    top: 20,
    right: 110,
    bottom: 60,
    left: 10,
    ...overrides,
  };
}

function overlap(overrides: Partial<OverlapSnapshot> = {}): OverlapSnapshot {
  return {
    coverSelector: '#cover',
    targetSelector: '#checkout',
    coverRect: rect(),
    targetRect: rect(),
    overlapRatio: 0.3,
    centerCovered: false,
    sampledHit: true,
    ...overrides,
  };
}

function snapshotWithOverlaps(
  overlaps: readonly OverlapSnapshot[],
): BrowserSnapshot {
  return {
    overflow: { viewportWidth: 320, documentWidth: 320, offenders: [] },
    overlaps,
    images: [],
  };
}

describe('evaluateVS002', () => {
  it('emits the cover and target as VS002 identity', () => {
    const pair = overlap({
      overlapRatio: 0.2501,
      centerCovered: false,
      sampledHit: true,
    });

    expect(evaluateVS002(snapshotWithOverlaps([pair]))[0]).toMatchObject({
      ruleId: 'VS002',
      selector: '#checkout',
      identity: [pair.coverSelector, pair.targetSelector],
    });
  });

  it.each([
    [0.25, false, true, 0],
    [0.2501, false, true, 1],
    [0.9, false, false, 0],
    [0.01, true, true, 1],
  ])(
    'applies raw ratio %s and hit tests',
    (overlapRatio, centerCovered, sampledHit, count) => {
      expect(
        evaluateVS002(
          snapshotWithOverlaps([
            overlap({ overlapRatio, centerCovered, sampledHit }),
          ]),
        ),
      ).toHaveLength(count);
    },
  );

  it('emits rounded public evidence without exposing sampledHit', () => {
    const finding = evaluateVS002(
      snapshotWithOverlaps([
        overlap({
          coverSelector: '#fixed-cover',
          targetSelector: '#pay-now',
          coverRect: rect({
            x: 1.234,
            left: 1.234,
            right: 101.239,
            width: 100.005,
          }),
          targetRect: rect({
            y: 2.345,
            top: 2.345,
            bottom: 42.35,
            height: 40.005,
          }),
          overlapRatio: 0.26005,
        }),
      ]),
    )[0];

    expect(finding).toEqual({
      ruleId: 'VS002',
      severity: 'error',
      message: 'Fixed/sticky element #fixed-cover covers actionable #pay-now',
      selector: '#pay-now',
      evidence: {
        kind: 'overlap',
        coverSelector: '#fixed-cover',
        targetSelector: '#pay-now',
        coverRect: {
          x: 1.23,
          y: 20,
          width: 100.01,
          height: 40,
          top: 20,
          right: 101.24,
          bottom: 60,
          left: 1.23,
        },
        targetRect: {
          x: 10,
          y: 2.35,
          width: 100,
          height: 40.01,
          top: 2.35,
          right: 110,
          bottom: 42.35,
          left: 10,
        },
        overlapRatio: 0.26,
        centerCovered: false,
      },
      identity: ['#fixed-cover', '#pay-now'],
    });
    expect(finding?.evidence).not.toHaveProperty('sampledHit');
  });

  it('preserves captured cover order then target order', () => {
    const pairs = [
      overlap({ coverSelector: '#cover-a', targetSelector: '#target-a' }),
      overlap({ coverSelector: '#cover-a', targetSelector: '#target-b' }),
      overlap({ coverSelector: '#cover-b', targetSelector: '#target-a' }),
      overlap({ coverSelector: '#cover-b', targetSelector: '#target-b' }),
    ];

    expect(
      evaluateVS002(snapshotWithOverlaps(pairs)).map(
        ({ identity }) => identity,
      ),
    ).toEqual([
      ['#cover-a', '#target-a'],
      ['#cover-a', '#target-b'],
      ['#cover-b', '#target-a'],
      ['#cover-b', '#target-b'],
    ]);
  });

  it('does not mutate its snapshot input', () => {
    const snapshot = snapshotWithOverlaps([
      overlap({ coverSelector: '#cover-a', targetSelector: '#target-a' }),
      overlap({ coverSelector: '#cover-b', targetSelector: '#target-b' }),
    ]);
    const before = structuredClone(snapshot);

    evaluateVS002(snapshot);

    expect(snapshot).toEqual(before);
  });
});
