import { fingerprintFor } from './fingerprint.js';
import { CONTENT_RULE_ORDER } from '../model/types.js';
import type {
  CombinationContext,
  Finding,
  FindingDraft,
  RuleEvaluation,
  RuleId,
} from '../model/types.js';

function immutableClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item: unknown) => immutableClone(item)),
    ) as T;
  }

  const clone = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, immutableClone(item)]),
  );
  return Object.freeze(clone) as T;
}

export function capDrafts(
  drafts: readonly FindingDraft[],
  limit = 25,
): RuleEvaluation {
  const findings = drafts.slice(0, limit);
  return {
    findings,
    omittedFindingCount: drafts.length - findings.length,
  };
}

export function materializeFinding(
  context: CombinationContext,
  draft: FindingDraft,
): Finding {
  return Object.freeze({
    ruleId: draft.ruleId,
    severity: draft.severity,
    message: draft.message,
    selector: draft.selector,
    evidence: immutableClone(draft.evidence),
    page: context.page.name,
    url: context.sanitizedUrl,
    viewport: Object.freeze({ ...context.viewport }),
    fingerprint: fingerprintFor(context, draft),
  });
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function ruleIndex(ruleId: RuleId): number {
  return ruleId === 'VSRUN001' ? 0 : CONTENT_RULE_ORDER.indexOf(ruleId) + 1;
}

function indexFor(
  indexes: ReadonlyMap<string, number>,
  name: string,
  kind: string,
): number {
  const index = indexes.get(name);
  if (index === undefined) {
    throw new Error(`Missing ${kind} config index for ${name}`);
  }
  return index;
}

export function sortFindings(
  findings: readonly Finding[],
  pageIndexes: ReadonlyMap<string, number>,
  viewportIndexes: ReadonlyMap<string, number>,
): Finding[] {
  for (const finding of findings) {
    indexFor(pageIndexes, finding.page, 'page');
    indexFor(viewportIndexes, finding.viewport.name, 'viewport');
  }

  return [...findings].sort((first, second) => {
    return (
      indexFor(pageIndexes, first.page, 'page') -
        indexFor(pageIndexes, second.page, 'page') ||
      indexFor(viewportIndexes, first.viewport.name, 'viewport') -
        indexFor(viewportIndexes, second.viewport.name, 'viewport') ||
      ruleIndex(first.ruleId) - ruleIndex(second.ruleId) ||
      compareText(first.selector, second.selector) ||
      compareText(first.fingerprint, second.fingerprint)
    );
  });
}
