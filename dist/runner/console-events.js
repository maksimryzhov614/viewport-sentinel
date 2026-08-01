import { normalizeMessage, sanitizeUrl } from '../core/privacy.js';
const STACK_LOCATION = /([A-Za-z][A-Za-z\d+.-]*:(?:\/\/)?[^\s()]*):(\d+):(\d+)(?=\)?(?:\s|$))/u;
function normalizedEvent(event) {
    return Object.freeze({
        eventType: event.eventType,
        message: normalizeMessage(event.message),
        sourceUrl: sanitizeUrl(event.sourceUrl),
        line: event.line,
        column: event.column,
    });
}
function pageErrorLocation(stack) {
    const match = stack === undefined ? null : STACK_LOCATION.exec(stack);
    if (match === null) {
        return { sourceUrl: '<inline>', line: 0, column: 0 };
    }
    const sourceUrl = match[1];
    const line = Number(match[2]);
    const column = Number(match[3]);
    if (sourceUrl === undefined ||
        !Number.isSafeInteger(line) ||
        !Number.isSafeInteger(column)) {
        return { sourceUrl: '<inline>', line: 0, column: 0 };
    }
    return { sourceUrl, line, column };
}
export function attachConsoleCapture(page) {
    const captured = [];
    let stopped = false;
    const onConsole = (message) => {
        if (stopped || message.type() !== 'error' || message.args().length === 0) {
            return;
        }
        const location = message.location();
        captured.push(normalizedEvent({
            eventType: 'console.error',
            message: message.text(),
            sourceUrl: location.url,
            line: location.line,
            column: location.column,
        }));
    };
    const onPageError = (error) => {
        if (stopped) {
            return;
        }
        const location = pageErrorLocation(error.stack);
        captured.push(normalizedEvent({
            eventType: 'pageerror',
            message: error.message,
            ...location,
        }));
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    return {
        stop() {
            if (stopped) {
                return;
            }
            stopped = true;
            try {
                page.off('console', onConsole);
            }
            finally {
                page.off('pageerror', onPageError);
            }
        },
        events() {
            return Object.freeze([...captured]);
        },
    };
}
//# sourceMappingURL=console-events.js.map