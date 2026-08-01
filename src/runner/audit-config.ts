import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright';
import { sortFindings } from '../core/findings.js';
import { sanitizeUrl } from '../core/privacy.js';
import type {
  AuditResult,
  CombinationContext,
  Finding,
  NormalizedConfig,
} from '../model/types.js';
import { auditCombination } from './audit-combination.js';

interface PackageMetadata {
  version: string;
}

const require = createRequire(import.meta.url);
const toolVersion = (require('../../package.json') as PackageMetadata).version;
const playwrightVersion = (
  require('playwright/package.json') as PackageMetadata
).version;

export interface AuditConfigDependencies {
  launchBrowser(): Promise<Browser>;
  auditCombination: typeof auditCombination;
}

export const defaultAuditConfigDependencies: AuditConfigDependencies =
  Object.freeze({
    launchBrowser: () => chromium.launch(),
    auditCombination,
  });

function safeCause(label: string): Readonly<{ name: string; message: string }> {
  return Object.freeze({ name: 'AuditFailureCause', message: label });
}

export class AuditExecutionError extends Error {
  override readonly name = 'AuditExecutionError';

  constructor(
    readonly result: AuditResult,
    message: string,
    causeLabel = 'Internal audit execution failed',
  ) {
    super(message, { cause: safeCause(causeLabel) });
  }
}

interface AuditProgress {
  browserVersion: string;
  completed: number;
  failedReadiness: number;
  suppressedConsoleCount: number;
  findings: Finding[];
  omittedByCombination: {
    page: string;
    viewport: string;
    ruleId: 'VS001' | 'VS002' | 'VS003' | 'VS004';
    count: number;
  }[];
}

function resultFromProgress(
  config: NormalizedConfig,
  progress: AuditProgress,
  complete: boolean,
): AuditResult {
  const pageIndexes = new Map(
    config.pages.map((page, index) => [page.name, index]),
  );
  const viewportIndexes = new Map(
    config.viewports.map((viewport, index) => [viewport.name, index]),
  );
  const findings = sortFindings(
    progress.findings,
    pageIndexes,
    viewportIndexes,
  );
  const omittedFindingCount = progress.omittedByCombination.reduce(
    (total, omitted) => total + omitted.count,
    0,
  );

  return {
    schemaVersion: 1,
    complete,
    tool: { name: 'viewport-sentinel', version: toolVersion },
    browser: {
      name: 'chromium',
      playwrightVersion,
      version: progress.browserVersion,
    },
    config: {
      version: 1,
      pages: config.pages.map((page) => ({
        name: page.name,
        url: sanitizeUrl(page.url),
        hasReadySelector: page.readySelector !== undefined,
        consoleIgnoreCount: page.consoleIgnore.length,
      })),
      viewports: config.viewports.map((viewport) => ({ ...viewport })),
      timeoutMs: config.timeoutMs,
      formats: [...config.formats],
    },
    combinations: {
      total: config.pages.length * config.viewports.length,
      completed: progress.completed,
      failedReadiness: progress.failedReadiness,
    },
    totals: {
      findingCount: findings.length,
      suppressedConsoleCount: progress.suppressedConsoleCount,
      omittedFindingCount,
      omittedByCombination: [...progress.omittedByCombination],
    },
    findings,
  };
}

function initialProgress(): AuditProgress {
  return {
    browserVersion: '<unavailable>',
    completed: 0,
    failedReadiness: 0,
    suppressedConsoleCount: 0,
    findings: [],
    omittedByCombination: [],
  };
}

export async function auditConfig(
  config: NormalizedConfig,
  dependencies: AuditConfigDependencies = defaultAuditConfigDependencies,
): Promise<AuditResult> {
  const progress = initialProgress();
  let browser: Browser;

  try {
    browser = await dependencies.launchBrowser();
  } catch {
    throw new AuditExecutionError(
      resultFromProgress(config, progress, false),
      'Audit execution failed during browser launch',
      'Browser launch failed',
    );
  }

  let result: AuditResult | undefined;
  let executionError: AuditExecutionError | undefined;

  try {
    progress.browserVersion = browser.version();

    for (const page of config.pages) {
      for (const viewport of config.viewports) {
        const context: CombinationContext = {
          page,
          viewport,
          sanitizedUrl: sanitizeUrl(page.url),
        };

        try {
          const combination = await dependencies.auditCombination(
            browser,
            context,
            config.timeoutMs,
          );
          progress.findings.push(...combination.findings);
          progress.suppressedConsoleCount += combination.suppressedConsoleCount;
          if (combination.readinessFailed) {
            progress.failedReadiness += 1;
          } else {
            progress.completed += 1;
          }
          for (const omitted of combination.omitted) {
            progress.omittedByCombination.push({
              page: page.name,
              viewport: viewport.name,
              ruleId: omitted.ruleId,
              count: omitted.count,
            });
          }
        } catch {
          executionError = new AuditExecutionError(
            resultFromProgress(config, progress, false),
            `Audit execution failed for ${page.name}/${viewport.name}`,
            'Combination execution failed',
          );
          break;
        }
      }
      if (executionError !== undefined) {
        break;
      }
    }

    if (executionError === undefined) {
      result = resultFromProgress(config, progress, true);
    }
  } catch {
    executionError = new AuditExecutionError(
      resultFromProgress(config, progress, false),
      'Audit execution failed during browser initialization',
      'Browser initialization failed',
    );
  }

  try {
    await browser.close();
  } catch {
    executionError ??= new AuditExecutionError(
      resultFromProgress(config, progress, false),
      'Audit execution failed while closing Chromium',
      'Browser cleanup failed',
    );
  }

  if (executionError !== undefined) {
    throw executionError;
  }
  if (result === undefined) {
    throw new AuditExecutionError(
      resultFromProgress(config, progress, false),
      'Audit execution failed',
    );
  }
  return result;
}
