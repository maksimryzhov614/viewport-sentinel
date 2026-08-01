import { capDrafts, materializeFinding } from '../core/findings.js';
import { normalizeMessage } from '../core/privacy.js';
import { CONTENT_RULE_ORDER, } from '../model/types.js';
import { captureBrowserSnapshot, } from '../rules/browser-snapshot.js';
import { evaluateVS001 } from '../rules/vs001-overflow.js';
import { evaluateVS002 } from '../rules/vs002-overlap.js';
import { evaluateVS003 } from '../rules/vs003-images.js';
import { evaluateVS004 } from '../rules/vs004-console.js';
import { createAuditContext } from './browser-context.js';
import { attachConsoleCapture } from './console-events.js';
import { createReadinessDeadline, ReadinessError, runReadinessStage, settlePage, } from './settle-page.js';
function evaluateContentRules(snapshot, events, ignores) {
    const consoleEvaluation = evaluateVS004(events, ignores);
    return {
        ruleDrafts: {
            VS001: evaluateVS001(snapshot),
            VS002: evaluateVS002(snapshot),
            VS003: evaluateVS003(snapshot),
            VS004: consoleEvaluation.drafts,
        },
        suppressedConsoleCount: consoleEvaluation.suppressedCount,
    };
}
export const defaultAuditCombinationDependencies = Object.freeze({
    createAuditContext,
    attachConsoleCapture,
    runReadinessStage,
    settlePage,
    captureBrowserSnapshot,
    evaluateContentRules,
});
function readinessResult(context, error) {
    return {
        findings: [
            materializeFinding(context, {
                ruleId: 'VSRUN001',
                severity: 'error',
                message: `Page readiness failed at ${error.stage}`,
                selector: 'document',
                evidence: {
                    kind: 'runtime',
                    stage: error.stage,
                    message: normalizeMessage(error.message),
                },
                identity: [error.stage],
            }),
        ],
        suppressedConsoleCount: 0,
        omitted: [],
        readinessFailed: true,
    };
}
export async function auditCombination(browser, context, timeoutMs, dependencies = defaultAuditCombinationDependencies) {
    const browserContext = await dependencies.createAuditContext(browser, context.viewport);
    let capture;
    try {
        const page = await browserContext.newPage();
        capture = dependencies.attachConsoleCapture(page);
        const deadline = createReadinessDeadline(timeoutMs);
        try {
            await dependencies.runReadinessStage('navigation', deadline, async (remainingTimeoutMs) => {
                await page.goto(context.page.url, {
                    waitUntil: 'domcontentloaded',
                    timeout: remainingTimeoutMs,
                });
            });
            await dependencies.settlePage(page, context.page, deadline);
        }
        catch (error) {
            if (error instanceof ReadinessError) {
                return readinessResult(context, error);
            }
            throw error;
        }
        const snapshot = await dependencies.captureBrowserSnapshot(page);
        const evaluation = dependencies.evaluateContentRules(snapshot, capture.events(), context.page.consoleIgnore);
        const findings = [];
        const omitted = [];
        for (const ruleId of CONTENT_RULE_ORDER) {
            const capped = capDrafts(evaluation.ruleDrafts[ruleId]);
            findings.push(...capped.findings.map((finding) => materializeFinding(context, finding)));
            if (capped.omittedFindingCount > 0) {
                omitted.push({ ruleId, count: capped.omittedFindingCount });
            }
        }
        return {
            findings,
            suppressedConsoleCount: evaluation.suppressedConsoleCount,
            omitted,
            readinessFailed: false,
        };
    }
    finally {
        try {
            capture?.stop();
        }
        finally {
            await browserContext.close();
        }
    }
}
//# sourceMappingURL=audit-combination.js.map