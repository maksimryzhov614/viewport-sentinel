import type { FindingDraft } from '../model/types.js';
import type { ConsoleEvent } from '../runner/console-events.js';
export interface VS004Evaluation {
    drafts: readonly FindingDraft[];
    suppressedCount: number;
}
export declare function evaluateVS004(events: readonly ConsoleEvent[], ignores: readonly string[]): VS004Evaluation;
//# sourceMappingURL=vs004-console.d.ts.map