import { roundCss, roundRect } from '../core/privacy.js';
function roundOffender(value) {
    return { selector: value.selector, rect: roundRect(value.rect) };
}
export function evaluateVS001(snapshot) {
    const { viewportWidth, documentWidth, offenders } = snapshot.overflow;
    if (documentWidth <= viewportWidth + 1) {
        return [];
    }
    return [
        {
            ruleId: 'VS001',
            severity: 'error',
            message: `Document is ${String(roundCss(documentWidth - viewportWidth))}px wider than the viewport`,
            selector: 'html',
            evidence: {
                kind: 'overflow',
                viewportWidth: roundCss(viewportWidth),
                documentWidth: roundCss(documentWidth),
                overflowPx: roundCss(documentWidth - viewportWidth),
                offenders: offenders.slice(0, 10).map(roundOffender),
            },
            identity: ['html'],
        },
    ];
}
//# sourceMappingURL=vs001-overflow.js.map