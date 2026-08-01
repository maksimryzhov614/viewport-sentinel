import { loadConfig } from '../config/load-config.js';
import type { CliEnvironment, CliRunResult } from '../model/types.js';
import { writeGitHubReport } from '../reporters/github.js';
import { writeJsonReport } from '../reporters/json.js';
import { writeSarifReport } from '../reporters/sarif.js';
import { writeTerminalSummary } from '../reporters/terminal.js';
import { auditConfig } from '../runner/audit-config.js';
export declare const CLI_HELP = "Usage: viewport-sentinel [options]\n\nOptions:\n  --config <path>  JSON configuration file\n  --output <dir>   Override report directory\n  --github         Emit GitHub annotations and step summary\n  --help           Show help\n  --version        Show version\n";
export interface RunCliDependencies {
    loadConfig: typeof loadConfig;
    auditConfig: typeof auditConfig;
    writeJsonReport: typeof writeJsonReport;
    writeSarifReport: typeof writeSarifReport;
    writeGitHubReport: typeof writeGitHubReport;
    writeTerminalSummary: typeof writeTerminalSummary;
}
export declare const defaultRunCliDependencies: RunCliDependencies;
export declare function processEnvironment(): CliEnvironment;
export declare function runCli(argv: readonly string[], environment?: CliEnvironment, dependencies?: RunCliDependencies): Promise<CliRunResult>;
//# sourceMappingURL=run-cli.d.ts.map