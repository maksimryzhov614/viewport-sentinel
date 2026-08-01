import { describe, expect, it } from 'vitest';
import {
  capDrafts,
  materializeFinding,
  sortFindings,
} from '../../src/core/findings.js';
import { fingerprintFor } from '../../src/core/fingerprint.js';
import type {
  CombinationContext,
  Finding,
  FindingDraft,
  RuleId,
} from '../../src/model/types.js';

const context: CombinationContext = {
  page: {
    name: 'home',
    url: 'https://example.test/private?secret=yes',
    consoleIgnore: [],
  },
  viewport: {
    name: 'mobile-320',
    width: 320,
    height: 844,
    deviceScaleFactor: 2,
  },
  sanitizedUrl: 'https://example.test/private',
};

function overlapDraft(overlapRatio = 0.26): FindingDraft {
  return {
    ruleId: 'VS002',
    severity: 'error',
    message: 'Target is covered',
    selector: '#target',
    evidence: {
      kind: 'overlap',
      coverSelector: '#cover',
      targetSelector: '#target',
      coverRect: {
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        top: 0,
        right: 20,
        bottom: 20,
        left: 0,
      },
      targetRect: {
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        top: 10,
        right: 30,
        bottom: 30,
        left: 10,
      },
      overlapRatio,
      centerCovered: true,
    },
    identity: ['#cover', '#target'],
  };
}

function draftAt(index: number): FindingDraft {
  return {
    ...overlapDraft(),
    selector: `#target-${String(index)}`,
    identity: [`#target-${String(index)}`],
  };
}

function sortableFinding(
  label: string,
  {
    page = 'page-z',
    viewport = 'viewport-z',
    ruleId = 'VS002',
    selector = '#same',
    fingerprint = 'sha256:b',
  }: {
    page?: string;
    viewport?: string;
    ruleId?: RuleId;
    selector?: string;
    fingerprint?: `sha256:${string}`;
  } = {},
): Finding {
  return {
    ruleId,
    severity: 'error',
    message: label,
    selector,
    evidence: { kind: 'runtime', stage: 'layout', message: label },
    page,
    url: `https://example.test/${page}`,
    viewport: {
      name: viewport,
      width: 320,
      height: 844,
      deviceScaleFactor: 1,
    },
    fingerprint,
  };
}

describe('fingerprintFor', () => {
  it('uses the exact versioned identity payload', () => {
    expect(fingerprintFor(context, overlapDraft())).toBe(
      'sha256:0d1a5286e26439461a44234cc8daae2557d5d32040402b370555d25f21eebb77',
    );
  });

  it('keeps VS002 geometry out of the fingerprint', () => {
    const first = overlapDraft(0.26);
    const second = overlapDraft(0.81);

    expect(fingerprintFor(context, first)).toBe(
      fingerprintFor(context, second),
    );
  });

  it('includes the unique configured page name', () => {
    const draft = overlapDraft();

    expect(fingerprintFor(context, draft)).not.toBe(
      fingerprintFor(
        { ...context, page: { ...context.page, name: 'other-state' } },
        draft,
      ),
    );
  });
});

describe('capDrafts', () => {
  it('caps a rule at 25 and counts omitted drafts', () => {
    const result = capDrafts(
      Array.from({ length: 28 }, (_, index) => draftAt(index)),
    );

    expect(result.findings).toHaveLength(25);
    expect(result.findings.map(({ selector }) => selector)).toEqual(
      Array.from({ length: 25 }, (_, index) => `#target-${String(index)}`),
    );
    expect(result.omittedFindingCount).toBe(3);
  });

  it('honors a custom cap without reordering drafts', () => {
    const drafts = [draftAt(2), draftAt(0), draftAt(1)];

    expect(capDrafts(drafts, 2)).toEqual({
      findings: [drafts[0], drafts[1]],
      omittedFindingCount: 1,
    });
  });
});

describe('materializeFinding', () => {
  it('copies context and draft data into a deeply immutable finding', () => {
    const mutableContext = structuredClone(context);
    const mutableDraft = structuredClone(overlapDraft());
    const finding = materializeFinding(mutableContext, mutableDraft);

    expect(finding).toEqual({
      ruleId: 'VS002',
      severity: 'error',
      message: 'Target is covered',
      selector: '#target',
      evidence: mutableDraft.evidence,
      page: 'home',
      url: 'https://example.test/private',
      viewport: mutableContext.viewport,
      fingerprint:
        'sha256:0d1a5286e26439461a44234cc8daae2557d5d32040402b370555d25f21eebb77',
    });
    expect(finding).not.toHaveProperty('identity');
    expect(finding.viewport).not.toBe(mutableContext.viewport);
    expect(finding.evidence).not.toBe(mutableDraft.evidence);
    expect(Object.isFrozen(finding)).toBe(true);
    expect(Object.isFrozen(finding.viewport)).toBe(true);
    expect(Object.isFrozen(finding.evidence)).toBe(true);
    if (finding.evidence.kind !== 'overlap') {
      throw new Error('expected overlap evidence');
    }
    expect(Object.isFrozen(finding.evidence.coverRect)).toBe(true);

    mutableContext.viewport.width = 999;
    if (mutableDraft.evidence.kind !== 'overlap') {
      throw new Error('expected overlap draft evidence');
    }
    mutableDraft.evidence.coverRect.width = 999;

    expect(finding.viewport.width).toBe(320);
    expect(finding.evidence.coverRect.width).toBe(20);
    expect(Reflect.set(finding.viewport, 'width', 999)).toBe(false);
  });
});

describe('sortFindings', () => {
  it('uses the complete deterministic ordering chain with config index maps', () => {
    const input = [
      sortableFinding('later-page', { page: 'page-a' }),
      sortableFinding('later-viewport', { viewport: 'viewport-a' }),
      sortableFinding('fingerprint-b'),
      sortableFinding('rule-4', { ruleId: 'VS004' }),
      sortableFinding('selector-b', { selector: '#z' }),
      sortableFinding('run', { ruleId: 'VSRUN001' }),
      sortableFinding('rule-3', { ruleId: 'VS003' }),
      sortableFinding('fingerprint-a', { fingerprint: 'sha256:a' }),
      sortableFinding('rule-1', { ruleId: 'VS001' }),
    ];
    const before = [...input];

    const sorted = sortFindings(
      input,
      new Map([
        ['page-z', 0],
        ['page-a', 1],
      ]),
      new Map([
        ['viewport-z', 0],
        ['viewport-a', 1],
      ]),
    );

    expect(sorted.map(({ message }) => message)).toEqual([
      'run',
      'rule-1',
      'fingerprint-a',
      'fingerprint-b',
      'selector-b',
      'rule-3',
      'rule-4',
      'later-viewport',
      'later-page',
    ]);
    expect(input).toEqual(before);
    expect(sorted).not.toBe(input);
  });
});
