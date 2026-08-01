import { sanitizeUrl } from '../core/privacy.js';
function sanitizeCandidate(value) {
    const descriptorIndex = value.search(/\s/u);
    if (descriptorIndex === -1) {
        return sanitizeUrl(value);
    }
    const sanitizedUrl = sanitizeUrl(value.slice(0, descriptorIndex));
    return sanitizedUrl === '<inline>'
        ? '<inline>'
        : `${sanitizedUrl}${value.slice(descriptorIndex)}`;
}
export function evaluateVS003(snapshot) {
    return snapshot.images
        .filter((image) => image.currentSrc === '' ||
        !image.complete ||
        image.naturalWidth < 1 ||
        image.naturalHeight < 1 ||
        image.decode === 'rejected')
        .map((image) => {
        const currentSrc = sanitizeUrl(image.currentSrc);
        return {
            ruleId: 'VS003',
            severity: 'error',
            message: 'Browser-selected image did not load and decode',
            selector: image.selector,
            evidence: {
                kind: 'image',
                selector: image.selector,
                currentSrc,
                sourceCandidates: image.sourceCandidates.map(sanitizeCandidate),
                complete: image.complete,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                decode: image.decode,
            },
            identity: [image.selector, currentSrc],
        };
    });
}
//# sourceMappingURL=vs003-images.js.map