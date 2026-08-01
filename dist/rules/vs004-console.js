import { canonicalStringify } from '../core/canonical.js';
import { normalizeMessage, sanitizeUrl } from '../core/privacy.js';
export function evaluateVS004(events, ignores) {
    const drafts = [];
    const seen = new Set();
    let suppressedCount = 0;
    for (const event of events) {
        const normalized = {
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
        ];
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
//# sourceMappingURL=vs004-console.js.map