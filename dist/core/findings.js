import { fingerprintFor } from './fingerprint.js';
import { CONTENT_RULE_ORDER } from '../model/types.js';
function immutableClone(value) {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return Object.freeze(value.map((item) => immutableClone(item)));
    }
    const clone = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableClone(item)]));
    return Object.freeze(clone);
}
export function capDrafts(drafts, limit = 25) {
    const findings = drafts.slice(0, limit);
    return {
        findings,
        omittedFindingCount: drafts.length - findings.length,
    };
}
export function materializeFinding(context, draft) {
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
function compareText(first, second) {
    return first < second ? -1 : first > second ? 1 : 0;
}
function ruleIndex(ruleId) {
    return ruleId === 'VSRUN001' ? 0 : CONTENT_RULE_ORDER.indexOf(ruleId) + 1;
}
function indexFor(indexes, name, kind) {
    const index = indexes.get(name);
    if (index === undefined) {
        throw new Error(`Missing ${kind} config index for ${name}`);
    }
    return index;
}
export function sortFindings(findings, pageIndexes, viewportIndexes) {
    for (const finding of findings) {
        indexFor(pageIndexes, finding.page, 'page');
        indexFor(viewportIndexes, finding.viewport.name, 'viewport');
    }
    return [...findings].sort((first, second) => {
        return (indexFor(pageIndexes, first.page, 'page') -
            indexFor(pageIndexes, second.page, 'page') ||
            indexFor(viewportIndexes, first.viewport.name, 'viewport') -
                indexFor(viewportIndexes, second.viewport.name, 'viewport') ||
            ruleIndex(first.ruleId) - ruleIndex(second.ruleId) ||
            compareText(first.selector, second.selector) ||
            compareText(first.fingerprint, second.fingerprint));
    });
}
//# sourceMappingURL=findings.js.map