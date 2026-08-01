import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { ConfigError, loadConfig } from '../config/load-config.js';
import { normalizeMessage } from '../core/privacy.js';
import type {
  AuditResult,
  CliEnvironment,
  CliRunResult,
  NormalizedConfig,
} from '../model/types.js';
import { writeGitHubReport } from '../reporters/github.js';
import { writeJsonReport } from '../reporters/json.js';
import { writeSarifReport } from '../reporters/sarif.js';
import { writeTerminalSummary } from '../reporters/terminal.js';
import { AuditExecutionError, auditConfig } from '../runner/audit-config.js';
import { parseCliArgs } from './parse-args.js';

interface PackageMetadata {
  version: string;
}

const require = createRequire(import.meta.url);
const toolVersion = (require('../../package.json') as PackageMetadata).version;

export const CLI_HELP = `Usage: viewport-sentinel [options]

Options:
  --config <path>  JSON configuration file
  --output <dir>   Override report directory
  --github         Emit GitHub annotations and step summary
  --help           Show help
  --version        Show version
`;

export interface RunCliDependencies {
  loadConfig: typeof loadConfig;
  auditConfig: typeof auditConfig;
  writeJsonReport: typeof writeJsonReport;
  writeSarifReport: typeof writeSarifReport;
  writeGitHubReport: typeof writeGitHubReport;
  writeTerminalSummary: typeof writeTerminalSummary;
}

export const defaultRunCliDependencies: RunCliDependencies = Object.freeze({
  loadConfig,
  auditConfig,
  writeJsonReport,
  writeSarifReport,
  writeGitHubReport,
  writeTerminalSummary,
});

interface ReportPaths {
  jsonPath?: string;
  sarifPath?: string;
}

export function processEnvironment(): CliEnvironment {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

async function defaultConfigPath(cwd: string): Promise<string> {
  const path = resolve(cwd, 'viewport-sentinel.config.json');
  try {
    await access(path);
    return path;
  } catch {
    throw new ConfigError('Config file not found; pass --config <path>');
  }
}

function incompleteResult(result: AuditResult): AuditResult {
  return result.complete ? { ...result, complete: false } : result;
}

async function writeConfiguredReports(
  result: AuditResult,
  config: NormalizedConfig,
  paths: ReportPaths,
  dependencies: RunCliDependencies,
): Promise<Error | undefined> {
  let firstError: Error | undefined;

  for (const format of config.formats) {
    try {
      if (format === 'json') {
        paths.jsonPath = await dependencies.writeJsonReport(
          result,
          config.outputDir,
        );
      } else {
        paths.sarifPath = await dependencies.writeSarifReport(
          result,
          config.outputDir,
          basename(config.configPath),
        );
      }
    } catch (error) {
      firstError ??=
        error instanceof Error ? error : new Error('Report writing failed');
    }
  }

  return firstError;
}

function relativeConfigPath(cwd: string, configPath: string): string {
  const path = relative(cwd, configPath);
  if (
    path === '' ||
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    return basename(configPath);
  }
  return path;
}

function errorLine(error: unknown): string {
  if (error instanceof ConfigError) {
    const message = normalizeMessage(error.message);
    return `Configuration error: ${message === '' ? 'Invalid configuration' : message}`;
  }
  if (error instanceof AuditExecutionError) {
    if (error.message === 'Audit execution failed during browser launch') {
      return 'Audit could not start: install Chromium with "npx playwright install chromium" and retry.';
    }
    if (error.message.includes('report writing failed')) {
      return 'Report writing failed: check the output directory permissions and retry.';
    }
    return 'Audit failed: partial reports were written when possible; fix the audit error and retry.';
  }
  return 'Audit failed: an unexpected internal error occurred; partial reports were written when possible.';
}

function writeError(environment: CliEnvironment, error: unknown): void {
  try {
    environment.stderr.write(`${errorLine(error)}\n`);
  } catch {
    // A broken stderr sink cannot be recovered from, but runCli remains non-exiting.
  }
}

function cliRunResult(
  exitCode: 0 | 1 | 2,
  findingCount: number,
  config: NormalizedConfig | undefined,
  paths: ReportPaths,
): CliRunResult {
  const result: CliRunResult = { exitCode, findingCount };
  if (config !== undefined) {
    result.outputDir = config.outputDir;
  }
  if (paths.jsonPath !== undefined) {
    result.jsonPath = paths.jsonPath;
  }
  if (paths.sarifPath !== undefined) {
    result.sarifPath = paths.sarifPath;
  }
  return result;
}

export async function runCli(
  argv: readonly string[],
  environment: CliEnvironment = processEnvironment(),
  dependencies: RunCliDependencies = defaultRunCliDependencies,
): Promise<CliRunResult> {
  let config: NormalizedConfig | undefined;
  let auditResult: AuditResult | undefined;
  const paths: ReportPaths = {};

  try {
    const parsed = parseCliArgs(argv);
    if (parsed.command === 'help') {
      environment.stdout.write(CLI_HELP);
      return { exitCode: 0, findingCount: 0 };
    }
    if (parsed.command === 'version') {
      environment.stdout.write(`${toolVersion}\n`);
      return { exitCode: 0, findingCount: 0 };
    }

    const configPath =
      parsed.config === undefined
        ? await defaultConfigPath(environment.cwd)
        : resolve(environment.cwd, parsed.config);
    const outputOverride =
      parsed.output === undefined
        ? undefined
        : resolve(environment.cwd, parsed.output);
    config = await dependencies.loadConfig(configPath, outputOverride);
    auditResult = await dependencies.auditConfig(config);

    const reportError = await writeConfiguredReports(
      auditResult,
      config,
      paths,
      dependencies,
    );
    if (reportError !== undefined) {
      throw reportError;
    }

    if (parsed.github) {
      try {
        await dependencies.writeGitHubReport(
          auditResult,
          relativeConfigPath(environment.cwd, config.configPath),
          environment.env,
        );
      } catch {
        throw new AuditExecutionError(
          incompleteResult(auditResult),
          'Audit GitHub report writing failed',
          'GitHub reporter failed',
        );
      }
    }

    dependencies.writeTerminalSummary(auditResult, environment.stdout);

    return cliRunResult(
      auditResult.totals.findingCount === 0 ? 0 : 1,
      auditResult.totals.findingCount,
      config,
      paths,
    );
  } catch (error) {
    const partialResult =
      error instanceof AuditExecutionError
        ? error.result
        : auditResult === undefined
          ? undefined
          : incompleteResult(auditResult);

    if (config !== undefined && partialResult !== undefined) {
      await writeConfiguredReports(
        incompleteResult(partialResult),
        config,
        paths,
        dependencies,
      );
    }

    writeError(environment, error);
    return cliRunResult(
      2,
      partialResult?.totals.findingCount ?? 0,
      config,
      paths,
    );
  }
}
