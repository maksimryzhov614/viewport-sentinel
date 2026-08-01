import { createHash } from 'node:crypto';
export function fingerprintFor(context, draft) {
    const payload = [
        1,
        draft.ruleId,
        context.page.name,
        context.sanitizedUrl,
        context.viewport.name,
        context.viewport.width,
        context.viewport.height,
        context.viewport.deviceScaleFactor,
        ...draft.identity,
    ];
    return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}
//# sourceMappingURL=fingerprint.js.map