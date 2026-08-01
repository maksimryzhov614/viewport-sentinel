import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { sortFindings } from '../core/findings.js';
import { sanitizeUrl } from '../core/privacy.js';
import { auditCombination } from './audit-combination.js';
const require = createRequire(import.meta.url);
const toolVersion = require('../../package.json').version;
const playwrightVersion = require('playwright/package.json').version;
export const defaultAuditConfigDependencies = Object.freeze({
    launchBrowser: () => chromium.launch(),
    auditCombination,
});
function safeCause(label) {
    return Object.freeze({ name: 'AuditFailureCause', message: label });
}
export class AuditExecutionError extends Error {
    result;
    name = 'AuditExecutionError';
    constructor(result, message, causeLabel = 'Internal audit execution failed') {
        super(message, { cause: safeCause(causeLabel) });
        this.result = result;
    }
}
function resultFromProgress(config, progress, complete) {
    const pageIndexes = new Map(config.pages.map((page, index) => [page.name, index]));
    const viewportIndexes = new Map(config.viewports.map((viewport, index) => [viewport.name, index]));
    const findings = sortFindings(progress.findings, pageIndexes, viewportIndexes);
    const omittedFindingCount = progress.omittedByCombination.reduce((total, omitted) => total + omitted.count, 0);
    return {
        schemaVersion: 1,
        complete,
        tool: { name: 'viewport-sentinel', version: toolVersion },
        browser: {
            name: 'chromium',
            playwrightVersion,
            version: progress.browserVersion,
        },
        config: {
            version: 1,
            pages: config.pages.map((page) => ({
                name: page.name,
                url: sanitizeUrl(page.url),
                hasReadySelector: page.readySelector !== undefined,
                consoleIgnoreCount: page.consoleIgnore.length,
            })),
            viewports: config.viewports.map((viewport) => ({ ...viewport })),
            timeoutMs: config.timeoutMs,
            formats: [...config.formats],
        },
        combinations: {
            total: config.pages.length * config.viewports.length,
            completed: progress.completed,
            failedReadiness: progress.failedReadiness,
        },
        totals: {
            findingCount: findings.length,
            suppressedConsoleCount: progress.suppressedConsoleCount,
            omittedFindingCount,
            omittedByCombination: [...progress.omittedByCombination],
        },
        findings,
    };
}
function initialProgress() {
    return {
        browserVersion: '<unavailable>',
        completed: 0,
        failedReadiness: 0,
        suppressedConsoleCount: 0,
        findings: [],
        omittedByCombination: [],
    };
}
export async function auditConfig(config, dependencies = defaultAuditConfigDependencies) {
    const progress = initialProgress();
    let browser;
    try {
        browser = await dependencies.launchBrowser();
    }
    catch {
        throw new AuditExecutionError(resultFromProgress(config, progress, false), 'Audit execution failed during browser launch', 'Browser launch failed');
    }
    let result;
    let executionError;
    try {
        progress.browserVersion = browser.version();
        for (const page of config.pages) {
            for (const viewport of config.viewports) {
                const context = {
                    page,
                    viewport,
                    sanitizedUrl: sanitizeUrl(page.url),
                };
                try {
                    const combination = await dependencies.auditCombination(browser, context, config.timeoutMs);
                    progress.findings.push(...combination.findings);
                    progress.suppressedConsoleCount += combination.suppressedConsoleCount;
                    if (combination.readinessFailed) {
                        progress.failedReadiness += 1;
                    }
                    else {
                        progress.completed += 1;
                    }
                    for (const omitted of combination.omitted) {
                        progress.omittedByCombination.push({
                            page: page.name,
                            viewport: viewport.name,
                            ruleId: omitted.ruleId,
                            count: omitted.count,
                        });
                    }
                }
                catch {
                    executionError = new AuditExecutionError(resultFromProgress(config, progress, false), `Audit execution failed for ${page.name}/${viewport.name}`, 'Combination execution failed');
                    break;
                }
            }
            if (executionError !== undefined) {
                break;
            }
        }
        if (executionError === undefined) {
            result = resultFromProgress(config, progress, true);
        }
    }
    catch {
        executionError = new AuditExecutionError(resultFromProgress(config, progress, false), 'Audit execution failed during browser initialization', 'Browser initialization failed');
    }
    try {
        await browser.close();
    }
    catch {
        executionError ??= new AuditExecutionError(resultFromProgress(config, progress, false), 'Audit execution failed while closing Chromium', 'Browser cleanup failed');
    }
    if (executionError !== undefined) {
        throw executionError;
    }
    if (result === undefined) {
        throw new AuditExecutionError(resultFromProgress(config, progress, false), 'Audit execution failed');
    }
    return result;
}
//# sourceMappingURL=audit-config.js.map