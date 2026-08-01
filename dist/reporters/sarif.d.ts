import type { AuditResult, FindingEvidence, RuleId, ViewportSpec } from '../model/types.js';
interface SarifRule {
    id: RuleId;
    name: string;
    shortDescription: {
        text: string;
    };
    fullDescription: {
        text: string;
    };
    helpUri: string;
}
interface SarifResult {
    ruleId: RuleId;
    level: 'error';
    message: {
        text: string;
    };
    locations: readonly {
        physicalLocation: {
            artifactLocation: {
                uri: string;
            };
        };
    }[];
    partialFingerprints: {
        primaryLocationLineHash: string;
    };
    properties: {
        page: string;
        viewport: ViewportSpec;
        selector: string;
        evidence: FindingEvidence;
    };
}
export interface SarifLog {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json';
    version: '2.1.0';
    runs: readonly {
        automationDetails: {
            id: 'viewport-sentinel/v1';
        };
        properties: {
            complete: boolean;
            configFile: string;
        };
        tool: {
            driver: {
                name: 'viewport-sentinel';
                version: string;
                informationUri: 'https://github.com/maksimryzhov614/viewport-sentinel';
                rules: readonly SarifRule[];
            };
        };
        results: readonly SarifResult[];
    }[];
}
export declare function toSarif(result: AuditResult, configFileName: string): SarifLog;
export declare function writeSarifReport(result: AuditResult, outputDir: string, configFileName: string): Promise<string>;
export {};
//# sourceMappingURL=sarif.d.ts.map