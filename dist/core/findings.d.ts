import type { CombinationContext, Finding, FindingDraft, RuleEvaluation } from '../model/types.js';
export declare function capDrafts(drafts: readonly FindingDraft[], limit?: number): RuleEvaluation;
export declare function materializeFinding(context: CombinationContext, draft: FindingDraft): Finding;
export declare function sortFindings(findings: readonly Finding[], pageIndexes: ReadonlyMap<string, number>, viewportIndexes: ReadonlyMap<string, number>): Finding[];
//# sourceMappingURL=findings.d.ts.map