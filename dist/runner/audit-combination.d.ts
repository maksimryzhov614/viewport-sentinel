import type { Browser } from 'playwright';
import { type CombinationContext, type CombinationResult, type ContentRuleId, type FindingDraft } from '../model/types.js';
import { captureBrowserSnapshot, type BrowserSnapshot } from '../rules/browser-snapshot.js';
import { createAuditContext } from './browser-context.js';
import { attachConsoleCapture, type ConsoleEvent } from './console-events.js';
import { runReadinessStage, settlePage } from './settle-page.js';
export interface ContentRulesEvaluation {
    ruleDrafts: Readonly<Record<ContentRuleId, readonly FindingDraft[]>>;
    suppressedConsoleCount: number;
}
export interface AuditCombinationDependencies {
    createAuditContext: typeof createAuditContext;
    attachConsoleCapture: typeof attachConsoleCapture;
    runReadinessStage: typeof runReadinessStage;
    settlePage: typeof settlePage;
    captureBrowserSnapshot: typeof captureBrowserSnapshot;
    evaluateContentRules(snapshot: BrowserSnapshot, events: readonly ConsoleEvent[], ignores: readonly string[]): ContentRulesEvaluation;
}
export declare const defaultAuditCombinationDependencies: AuditCombinationDependencies;
export declare function auditCombination(browser: Browser, context: CombinationContext, timeoutMs: number, dependencies?: AuditCombinationDependencies): Promise<CombinationResult>;
//# sourceMappingURL=audit-combination.d.ts.map