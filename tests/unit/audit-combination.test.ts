import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright';
import { canonicalStringify } from '../../src/core/canonical.js';
import { materializeFinding } from '../../src/core/findings.js';
import type {
  AuditResult,
  CombinationContext,
  CombinationResult,
  ContentRuleId,
  FindingDraft,
  NormalizedConfig,
} from '../../src/model/types.js';
import {
  auditCombination,
  defaultAuditCombinationDependencies,
  type AuditCombinationDependencies,
} from '../../src/runner/audit-combination.js';
import {
  AuditExecutionError,
  auditConfig,
  defaultAuditConfigDependencies,
} from '../../src/runner/audit-config.js';
import { ReadinessError } from '../../src/runner/settle-page.js';
import { writeJsonReport } from '../../src/reporters/json.js';

const combinationContext: CombinationContext = {
  page: {
    name: 'home',
    url: 'https://user:pass@example.test/home?secret=yes#token',
    consoleIgnore: [],
  },
  viewport: {
    name: 'mobile-320',
    width: 320,
    height: 844,
    deviceScaleFactor: 1,
  },
  sanitizedUrl: 'https://example.test/home',
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function draft(ruleId: ContentRuleId, index = 0): FindingDraft {
  return {
    ruleId,
    severity: 'error',
    message: `${ruleId} finding ${String(index)}`,
    selector: `#${ruleId.toLowerCase()}-${String(index)}`,
    evidence: {
      kind: 'runtime',
      stage: 'layout',
      message: `${ruleId} evidence ${String(index)}`,
    },
    identity: [index],
  };
}

function emptyRuleDrafts(): Record<ContentRuleId, readonly FindingDraft[]> {
  return { VS001: [], VS002: [], VS003: [], VS004: [] };
}

function combinationResult(
  context: CombinationContext,
  ruleId?: ContentRuleId,
): CombinationResult {
  return {
    findings:
      ruleId === undefined ? [] : [materializeFinding(context, draft(ruleId))],
    suppressedConsoleCount: 0,
    omitted: [],
    readinessFailed: false,
  };
}

function fakeCombinationResources() {
  const goto = vi.fn().mockResolvedValue(undefined);
  const page = {
    goto,
  } as unknown as Page;
  const contextClose = vi.fn().mockResolvedValue(undefined);
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: contextClose,
  } as unknown as BrowserContext;
  const captureStop = vi.fn();
  const capture = {
    stop: captureStop,
    events: vi.fn().mockReturnValue([]),
  };
  const settlePage = vi
    .fn<AuditCombinationDependencies['settlePage']>()
    .mockResolvedValue(undefined);
  const evaluateContentRules = vi
    .fn<AuditCombinationDependencies['evaluateContentRules']>()
    .mockReturnValue({
      ruleDrafts: emptyRuleDrafts(),
      suppressedConsoleCount: 0,
    });
  const dependencies: AuditCombinationDependencies = {
    ...defaultAuditCombinationDependencies,
    createAuditContext: vi.fn().mockResolvedValue(context),
    attachConsoleCapture: vi.fn().mockReturnValue(capture),
    settlePage,
    captureBrowserSnapshot: vi.fn().mockResolvedValue({
      overflow: { viewportWidth: 320, documentWidth: 320, offenders: [] },
      overlaps: [],
      images: [],
    }),
    evaluateContentRules,
  };
  return {
    page,
    context,
    capture,
    goto,
    contextClose,
    captureStop,
    settlePage,
    evaluateContentRules,
    dependencies,
  };
}

function normalizedConfig(): NormalizedConfig {
  return {
    version: 1,
    configPath: '/private/config/golden.json',
    pages: [
      {
        name: 'first',
        url: 'https://user:pass@example.test/first?secret=yes#token',
        readySelector: '#ready',
        consoleIgnore: ['private-pattern'],
      },
      {
        name: 'second',
        url: 'https://example.test/second',
        consoleIgnore: [],
      },
    ],
    viewports: [
      {
        name: 'mobile-320',
        width: 320,
        height: 844,
        deviceScaleFactor: 1,
      },
      {
        name: 'desktop-1440',
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
    ],
    timeoutMs: 1_000,
    outputDir: '/private/artifacts',
    formats: ['json', 'sarif'],
  };
}

function fakeBrowser() {
  const close = vi.fn().mockResolvedValue(undefined);
  const browser = {
    version: vi.fn().mockReturnValue('123.0.4567.8'),
    close,
  } as unknown as Browser;
  return { browser, close };
}

function emptyAuditResult(complete = true): AuditResult {
  return {
    schemaVersion: 1,
    complete,
    tool: { name: 'viewport-sentinel', version: '0.0.0' },
    browser: {
      name: 'chromium',
      playwrightVersion: '1.62.1',
      version: '123.0.4567.8',
    },
    config: {
      version: 1,
      pages: [],
      viewports: [],
      timeoutMs: 1_000,
      formats: ['json'],
    },
    combinations: { total: 0, completed: 0, failedReadiness: 0 },
    totals: {
      findingCount: 0,
      suppressedConsoleCount: 0,
      omittedFindingCount: 0,
      omittedByCombination: [],
    },
    findings: [],
  };
}

describe('auditCombination', () => {
  it('turns readiness failure into one VSRUN001 and skips content rules', async () => {
    const resources = fakeCombinationResources();
    resources.settlePage.mockRejectedValue(
      new ReadinessError(
        'ready-selector',
        'Missing https://user:pass@example.test/page?secret=yes#token',
      ),
    );

    const result = await auditCombination(
      {} as Browser,
      combinationContext,
      1_000,
      resources.dependencies,
    );

    expect(result).toMatchObject({
      readinessFailed: true,
      suppressedConsoleCount: 0,
      omitted: [],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'VSRUN001',
      selector: 'document',
      url: 'https://example.test/home',
      evidence: {
        kind: 'runtime',
        stage: 'ready-selector',
        message: 'Missing https://example.test/page',
      },
    });
    expect(resources.evaluateContentRules).not.toHaveBeenCalled();
    expect(resources.captureStop).toHaveBeenCalledOnce();
    expect(resources.contextClose).toHaveBeenCalledOnce();
  });

  it('uses one deadline for navigation and later readiness work', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const resources = fakeCombinationResources();
    resources.goto.mockImplementation(() => {
      vi.setSystemTime(10_400);
      return Promise.resolve(null);
    });
    resources.settlePage.mockImplementation((_page, _pageSpec, deadline) => {
      expect(deadline.expiresAt).toBe(11_000);
      expect(deadline.expiresAt - Date.now()).toBe(600);
      return Promise.resolve();
    });

    await auditCombination(
      {} as Browser,
      combinationContext,
      1_000,
      resources.dependencies,
    );

    expect(resources.goto).toHaveBeenCalledWith(combinationContext.page.url, {
      waitUntil: 'domcontentloaded',
      timeout: 1_000,
    });
  });

  it('projects rules in fixed order, caps each rule, and records omissions', async () => {
    const resources = fakeCombinationResources();
    resources.evaluateContentRules.mockReturnValue({
      ruleDrafts: {
        VS004: [draft('VS004')],
        VS003: [],
        VS002: Array.from({ length: 26 }, (_, index) => draft('VS002', index)),
        VS001: Array.from({ length: 27 }, (_, index) => draft('VS001', index)),
      },
      suppressedConsoleCount: 3,
    });

    const result = await auditCombination(
      {} as Browser,
      combinationContext,
      1_000,
      resources.dependencies,
    );

    expect(result.findings).toHaveLength(51);
    expect(result.findings.map(({ ruleId }) => ruleId)).toEqual([
      ...Array.from({ length: 25 }, () => 'VS001'),
      ...Array.from({ length: 25 }, () => 'VS002'),
      'VS004',
    ]);
    expect(result.omitted).toEqual([
      { ruleId: 'VS001', count: 2 },
      { ruleId: 'VS002', count: 1 },
    ]);
    expect(result.suppressedConsoleCount).toBe(3);
  });

  it('stops listeners and closes the context after an internal exception', async () => {
    const resources = fakeCombinationResources();
    resources.evaluateContentRules.mockImplementation(() => {
      throw new Error('internal secret https://example.test/?token=yes');
    });

    await expect(
      auditCombination(
        {} as Browser,
        combinationContext,
        1_000,
        resources.dependencies,
      ),
    ).rejects.toThrow('internal secret');
    expect(resources.captureStop).toHaveBeenCalledOnce();
    expect(resources.contextClose).toHaveBeenCalledOnce();
  });
});

describe('auditConfig', () => {
  it('runs the page-outer viewport-inner matrix serially in config order', async () => {
    const { browser, close } = fakeBrowser();
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;

    const result = await auditConfig(normalizedConfig(), {
      ...defaultAuditConfigDependencies,
      launchBrowser: vi.fn().mockResolvedValue(browser),
      auditCombination: vi
        .fn()
        .mockImplementation(
          async (_browser: Browser, context: CombinationContext) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            order.push(`${context.page.name}/${context.viewport.name}`);
            await new Promise<void>((resolve) => setImmediate(resolve));
            active -= 1;
            return combinationResult(context);
          },
        ),
    });

    expect(order).toEqual([
      'first/mobile-320',
      'first/desktop-1440',
      'second/mobile-320',
      'second/desktop-1440',
    ]);
    expect(maximumActive).toBe(1);
    expect(result.combinations).toEqual({
      total: 4,
      completed: 4,
      failedReadiness: 0,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('continues later viewports after one VSRUN001', async () => {
    const { browser } = fakeBrowser();
    const config = normalizedConfig();
    const firstPage = config.pages[0];
    const firstViewport = config.viewports[0];
    if (firstPage === undefined || firstViewport === undefined) {
      throw new Error('test config matrix is empty');
    }
    const runFinding = materializeFinding(
      {
        page: firstPage,
        viewport: firstViewport,
        sanitizedUrl: 'https://example.test/first',
      },
      {
        ruleId: 'VSRUN001',
        severity: 'error',
        message: 'Page readiness failed at ready-selector',
        selector: 'document',
        evidence: {
          kind: 'runtime',
          stage: 'ready-selector',
          message: 'selector missing',
        },
        identity: ['ready-selector'],
      },
    );
    let call = 0;

    const result = await auditConfig(
      { ...config, pages: [firstPage], viewports: config.viewports },
      {
        ...defaultAuditConfigDependencies,
        launchBrowser: vi.fn().mockResolvedValue(browser),
        auditCombination: vi
          .fn()
          .mockImplementation(
            (_browser: Browser, context: CombinationContext) => {
              call += 1;
              return Promise.resolve(
                call === 1
                  ? {
                      findings: [runFinding],
                      suppressedConsoleCount: 0,
                      omitted: [],
                      readinessFailed: true,
                    }
                  : combinationResult(context),
              );
            },
          ),
      },
    );

    expect(call).toBe(2);
    expect(result.findings.map(({ ruleId }) => ruleId)).toEqual(['VSRUN001']);
    expect(result.combinations).toEqual({
      total: 2,
      completed: 1,
      failedReadiness: 1,
    });
  });

  it('aggregates suppression and omitted counts by combination in matrix order', async () => {
    const { browser } = fakeBrowser();
    const config = normalizedConfig();
    const firstPage = config.pages[0];
    if (firstPage === undefined) {
      throw new Error('test config has no first page');
    }
    let call = 0;

    const result = await auditConfig(
      { ...config, pages: [firstPage] },
      {
        ...defaultAuditConfigDependencies,
        launchBrowser: vi.fn().mockResolvedValue(browser),
        auditCombination: vi
          .fn()
          .mockImplementation(
            (_browser: Browser, context: CombinationContext) => {
              call += 1;
              return Promise.resolve({
                ...combinationResult(context, 'VS001'),
                suppressedConsoleCount: call === 1 ? 2 : 1,
                omitted:
                  call === 1
                    ? [{ ruleId: 'VS002' as const, count: 3 }]
                    : [{ ruleId: 'VS001' as const, count: 1 }],
              });
            },
          ),
      },
    );

    expect(result.totals).toEqual({
      findingCount: 2,
      suppressedConsoleCount: 3,
      omittedFindingCount: 4,
      omittedByCombination: [
        {
          page: 'first',
          viewport: 'mobile-320',
          ruleId: 'VS002',
          count: 3,
        },
        {
          page: 'first',
          viewport: 'desktop-1440',
          ruleId: 'VS001',
          count: 1,
        },
      ],
    });
  });

  it('rejects on the first internal failure with a writable partial result', async () => {
    const { browser, close } = fakeBrowser();
    const config = normalizedConfig();
    const audit = vi
      .fn()
      .mockImplementationOnce((_browser, context: CombinationContext) =>
        Promise.resolve(combinationResult(context, 'VS001')),
      )
      .mockRejectedValueOnce(
        new Error(
          'rule failed at https://user:pass@example.test/?secret=yes#token',
        ),
      );

    let caught: unknown;
    try {
      await auditConfig(config, {
        ...defaultAuditConfigDependencies,
        launchBrowser: vi.fn().mockResolvedValue(browser),
        auditCombination: audit,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuditExecutionError);
    if (!(caught instanceof AuditExecutionError)) {
      throw new Error('expected AuditExecutionError');
    }
    expect(audit).toHaveBeenCalledTimes(2);
    expect(caught.message).toBe(
      'Audit execution failed for first/desktop-1440',
    );
    expect(caught.cause).toEqual({
      name: 'AuditFailureCause',
      message: 'Combination execution failed',
    });
    expect(caught.cause).not.toHaveProperty('stack');
    expect(caught.result.complete).toBe(false);
    expect(caught.result.combinations).toEqual({
      total: 4,
      completed: 1,
      failedReadiness: 0,
    });
    expect(caught.result.findings.map(({ ruleId }) => ruleId)).toEqual([
      'VS001',
    ]);
    expect(JSON.stringify(caught.result)).not.toContain('secret');
    expect(JSON.stringify(caught)).not.toContain('secret');
    expect(close).toHaveBeenCalledOnce();

    const directory = await mkdtemp(join(tmpdir(), 'viewport-sentinel-'));
    temporaryDirectories.push(directory);
    const jsonPath = await writeJsonReport(caught.result, directory);
    const report = JSON.parse(await readFile(jsonPath, 'utf8')) as AuditResult;
    expect(report.complete).toBe(false);
    expect(report.combinations.completed).toBe(1);
  });

  it('returns a safe empty partial result when Chromium launch fails', async () => {
    const config = normalizedConfig();
    let caught: unknown;

    try {
      await auditConfig(config, {
        ...defaultAuditConfigDependencies,
        launchBrowser: vi
          .fn()
          .mockRejectedValue(
            new Error('/private/user/path?secret=yes browser unavailable'),
          ),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuditExecutionError);
    if (!(caught instanceof AuditExecutionError)) {
      throw new Error('expected AuditExecutionError');
    }
    expect(caught.message).toBe('Audit execution failed during browser launch');
    expect(caught.result).toMatchObject({
      complete: false,
      browser: { version: '<unavailable>' },
      combinations: { total: 4, completed: 0, failedReadiness: 0 },
      findings: [],
    });
    expect(JSON.stringify(caught)).not.toContain('/private/user/path');
    expect(JSON.stringify(caught.result)).not.toContain('/private');
  });

  it('sanitizes report config and sorts findings with explicit config indexes', async () => {
    const { browser } = fakeBrowser();
    const config = normalizedConfig();

    const result = await auditConfig(config, {
      ...defaultAuditConfigDependencies,
      launchBrowser: vi.fn().mockResolvedValue(browser),
      auditCombination: vi
        .fn()
        .mockImplementation((_browser: Browser, context: CombinationContext) =>
          Promise.resolve(combinationResult(context, 'VS004')),
        ),
    });

    expect(result.tool).toEqual({
      name: 'viewport-sentinel',
      version: '0.0.0',
    });
    expect(result.browser).toEqual({
      name: 'chromium',
      playwrightVersion: '1.62.1',
      version: '123.0.4567.8',
    });
    expect(result.config.pages).toEqual([
      {
        name: 'first',
        url: 'https://example.test/first',
        hasReadySelector: true,
        consoleIgnoreCount: 1,
      },
      {
        name: 'second',
        url: 'https://example.test/second',
        hasReadySelector: false,
        consoleIgnoreCount: 0,
      },
    ]);
    expect(result).not.toHaveProperty('configPath');
    expect(JSON.stringify(result)).not.toContain('/private');
    expect(
      result.findings.map(({ page, viewport }) => [page, viewport.name]),
    ).toEqual([
      ['first', 'mobile-320'],
      ['first', 'desktop-1440'],
      ['second', 'mobile-320'],
      ['second', 'desktop-1440'],
    ]);
  });
});

describe('writeJsonReport', () => {
  it('atomically writes canonical JSON through only results.json.tmp', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'viewport-sentinel-'));
    temporaryDirectories.push(directory);
    const result = emptyAuditResult();

    const reportPath = await writeJsonReport(result, directory);

    expect(reportPath).toBe(join(directory, 'results.json'));
    expect(await readFile(reportPath, 'utf8')).toBe(canonicalStringify(result));
    await expect(
      readFile(join(directory, 'results.json.tmp')),
    ).rejects.toThrow();
  });

  it('removes only its tmp file after failure and preserves unrelated output files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'viewport-sentinel-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'unrelated.txt'), 'keep me', 'utf8');
    await mkdir(join(directory, 'results.json'));

    let caught: unknown;
    try {
      await writeJsonReport(emptyAuditResult(), directory);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuditExecutionError);
    if (!(caught instanceof AuditExecutionError)) {
      throw new Error('expected AuditExecutionError');
    }
    expect(caught.result.complete).toBe(false);
    expect(await readFile(join(directory, 'unrelated.txt'), 'utf8')).toBe(
      'keep me',
    );
    await expect(
      readFile(join(directory, 'results.json.tmp')),
    ).rejects.toThrow();
  });
});
