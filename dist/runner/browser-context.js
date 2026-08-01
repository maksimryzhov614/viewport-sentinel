export function createAuditContext(browser, viewport) {
    return browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        timezoneId: 'UTC',
        locale: 'en-US',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
    });
}
//# sourceMappingURL=browser-context.js.map