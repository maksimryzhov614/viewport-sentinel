import { canonicalStringify } from '../core/canonical.js';
import { normalizeMessage, sanitizeUrl } from '../core/privacy.js';
import type { FindingDraft } from '../model/types.js';
import type { ConsoleEvent } from '../runner/console-events.js';

export interface VS004Evaluation {
  drafts: readonly FindingDraft[];
  suppressedCount: number;
}

export function evaluateVS004(
  events: readonly ConsoleEvent[],
  ignores: readonly string[],
): VS004Evaluation {
  const drafts: FindingDraft[] = [];
  const seen = new Set<string>();
  let suppressedCount = 0;

  for (const event of events) {
    const normalized: ConsoleEvent = {
      eventType: event.eventType,
      message: normalizeMessage(event.message),
      sourceUrl: sanitizeUrl(event.sourceUrl),
      line: event.line,
      column: event.column,
    };
    const identity = [
      normalized.eventType,
      normalized.message,
      normalized.sourceUrl,
      normalized.line,
      normalized.column,
    ] as const;
    const key = canonicalStringify(identity);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (ignores.some((ignore) => normalized.message.includes(ignore))) {
      suppressedCount += 1;
      continue;
    }

    drafts.push({
      ruleId: 'VS004',
      severity: 'error',
      message: normalized.message,
      selector: 'document',
      evidence: { kind: 'console', ...normalized },
      identity,
    });
  }

  return { drafts, suppressedCount };
}
