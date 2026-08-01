import { describe, expect, it } from 'vitest';
import type {
  BrowserSnapshot,
  ImageSnapshot,
} from '../../src/rules/browser-snapshot.js';
import { evaluateVS003 } from '../../src/rules/vs003-images.js';

function image(overrides: Partial<ImageSnapshot> = {}): ImageSnapshot {
  return {
    selector: '#product-image',
    currentSrc: 'https://example.test/x.webp',
    sourceCandidates: ['https://example.test/x.webp 1x'],
    complete: true,
    naturalWidth: 120,
    naturalHeight: 80,
    decode: 'resolved',
    ...overrides,
  };
}

function snapshotWithImages(images: readonly ImageSnapshot[]): BrowserSnapshot {
  return {
    overflow: { viewportWidth: 320, documentWidth: 320, offenders: [] },
    overlaps: [],
    images,
  };
}

describe('evaluateVS003', () => {
  it.each([
    [
      {
        currentSrc: '',
        complete: true,
        naturalWidth: 0,
        naturalHeight: 0,
        decode: 'rejected' as const,
      },
      1,
    ],
    [
      {
        currentSrc: '/x.webp',
        complete: false,
        naturalWidth: 0,
        naturalHeight: 0,
        decode: 'timeout' as const,
      },
      1,
    ],
    [
      {
        currentSrc: '/x.webp',
        complete: true,
        naturalWidth: 120,
        naturalHeight: 80,
        decode: 'rejected' as const,
      },
      1,
    ],
    [
      {
        currentSrc: '/x.webp',
        complete: true,
        naturalWidth: 120,
        naturalHeight: 80,
        decode: 'timeout' as const,
      },
      0,
    ],
    [
      {
        currentSrc: '/x.webp',
        complete: true,
        naturalWidth: 120,
        naturalHeight: 80,
        decode: 'resolved' as const,
      },
      0,
    ],
  ])('classifies image state %#', (state, expected) => {
    expect(evaluateVS003(snapshotWithImages([image(state)]))).toHaveLength(
      expected,
    );
  });

  it.each([
    [{ currentSrc: '' }, 1],
    [{ complete: false }, 1],
    [{ naturalWidth: 0 }, 1],
    [{ naturalHeight: 0 }, 1],
    [{ decode: 'rejected' as const }, 1],
    [{ decode: 'timeout' as const }, 0],
  ])('fails only the specified predicate branch %#', (state, expected) => {
    expect(evaluateVS003(snapshotWithImages([image(state)]))).toHaveLength(
      expected,
    );
  });

  it('sanitizes selected and candidate URL tokens without changing descriptors', () => {
    const finding = evaluateVS003(
      snapshotWithImages([
        image({
          selector: '#catalogue-image',
          currentSrc:
            'https://alice:secret@example.test/selected.webp?token=selected#hero',
          sourceCandidates: [
            'https://bob:password@example.test/small.webp?token=small#one 1x',
            'https://example.test/large.webp?token=large#two 2x',
            'https://example.test/wide.webp?token=wide#three 640w',
          ],
          decode: 'rejected',
        }),
      ]),
    )[0];

    expect(finding).toEqual({
      ruleId: 'VS003',
      severity: 'error',
      message: 'Browser-selected image did not load and decode',
      selector: '#catalogue-image',
      evidence: {
        kind: 'image',
        selector: '#catalogue-image',
        currentSrc: 'https://example.test/selected.webp',
        sourceCandidates: [
          'https://example.test/small.webp 1x',
          'https://example.test/large.webp 2x',
          'https://example.test/wide.webp 640w',
        ],
        complete: true,
        naturalWidth: 120,
        naturalHeight: 80,
        decode: 'rejected',
      },
      identity: ['#catalogue-image', 'https://example.test/selected.webp'],
    });
  });

  it('replaces non-HTTP(S) selected and candidate payloads with inline markers', () => {
    const finding = evaluateVS003(
      snapshotWithImages([
        image({
          currentSrc: 'data:image/png;base64,PRIVATE_CURRENT_TOKEN',
          sourceCandidates: [
            'javascript:PRIVATE_JAVASCRIPT_TOKEN 1x',
            'blob:https://example.test/PRIVATE_BLOB_TOKEN 2x',
            'data:image/png;base64,PRIVATE_DATA_TOKEN 640w',
          ],
          decode: 'rejected',
        }),
      ]),
    )[0];

    expect(finding).toMatchObject({
      evidence: {
        kind: 'image',
        currentSrc: '<inline>',
        sourceCandidates: ['<inline> 1x', '<inline> 2x', '<inline> 640w'],
      },
      identity: ['#product-image', '<inline>'],
    });
    expect(JSON.stringify(finding)).not.toMatch(
      /PRIVATE_|data:image|javascript:|blob:/u,
    );
  });

  it('preserves image order and does not mutate its snapshot input', () => {
    const snapshot = snapshotWithImages([
      image({ selector: '#first', currentSrc: '', decode: 'rejected' }),
      image({ selector: '#second', complete: false }),
    ]);
    const before = structuredClone(snapshot);

    const findings = evaluateVS003(snapshot);

    expect(findings.map(({ selector }) => selector)).toEqual([
      '#first',
      '#second',
    ]);
    expect(snapshot).toEqual(before);
  });
});
