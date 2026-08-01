import { type Browser } from 'playwright';
import type { AuditResult, NormalizedConfig } from '../model/types.js';
import { auditCombination } from './audit-combination.js';
export interface AuditConfigDependencies {
    launchBrowser(): Promise<Browser>;
    auditCombination: typeof auditCombination;
}
export declare const defaultAuditConfigDependencies: AuditConfigDependencies;
export declare class AuditExecutionError extends Error {
    readonly result: AuditResult;
    readonly name = "AuditExecutionError";
    constructor(result: AuditResult, message: string, causeLabel?: string);
}
export declare function auditConfig(config: NormalizedConfig, dependencies?: AuditConfigDependencies): Promise<AuditResult>;
//# sourceMappingURL=audit-config.d.ts.map