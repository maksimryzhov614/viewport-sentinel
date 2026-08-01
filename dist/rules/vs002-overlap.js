import { roundCss, roundRect } from '../core/privacy.js';
export function evaluateVS002(snapshot) {
    return snapshot.overlaps
        .filter((pair) => pair.centerCovered || (pair.overlapRatio > 0.25 && pair.sampledHit))
        .map((pair) => ({
        ruleId: 'VS002',
        severity: 'error',
        message: `Fixed/sticky element ${pair.coverSelector} covers actionable ${pair.targetSelector}`,
        selector: pair.targetSelector,
        evidence: {
            kind: 'overlap',
            coverSelector: pair.coverSelector,
            targetSelector: pair.targetSelector,
            coverRect: roundRect(pair.coverRect),
            targetRect: roundRect(pair.targetRect),
            overlapRatio: roundCss(pair.overlapRatio),
            centerCovered: pair.centerCovered,
        },
        identity: [pair.coverSelector, pair.targetSelector],
    }));
}
//# sourceMappingURL=vs002-overlap.js.map