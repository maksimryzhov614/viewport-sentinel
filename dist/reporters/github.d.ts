import type { AuditResult } from '../model/types.js';
export type GitHubReporterEnvironment = Readonly<NodeJS.ProcessEnv>;
export declare function writeGitHubReport(result: AuditResult, relativeConfigPath: string, environment: GitHubReporterEnvironment): Promise<void>;
//# sourceMappingURL=github.d.ts.map