import type { Page } from 'playwright';
import type { NormalizedPageSpec, ReadinessDeadline, ReadinessStage } from '../model/types.js';
export declare class ReadinessError extends Error {
    readonly stage: ReadinessStage;
    readonly name = "ReadinessError";
    constructor(stage: ReadinessStage, message: string);
}
export declare function createReadinessDeadline(timeoutMs: number): ReadinessDeadline;
export declare function runReadinessStage<T>(stage: ReadinessStage, deadline: ReadinessDeadline, operation: (timeoutMs: number) => Promise<T>): Promise<T>;
export declare function settlePage(page: Page, pageSpec: NormalizedPageSpec, deadline: ReadinessDeadline): Promise<void>;
//# sourceMappingURL=settle-page.d.ts.map