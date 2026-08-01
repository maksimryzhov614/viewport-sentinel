export const CONTENT_RULE_ORDER = ['VS001', 'VS002', 'VS003', 'VS004'] as const;
export type ContentRuleId = (typeof CONTENT_RULE_ORDER)[number];
export type RuleId = ContentRuleId | 'VSRUN001';
export type ReadinessStage =
  'navigation' | 'ready-selector' | 'fonts' | 'layout';
export type ExitCode = 0 | 1 | 2;
export type ReportFormat = 'json' | 'sarif';

export function isRuleId(value: string): value is RuleId {
  return (
    value === 'VSRUN001' || CONTENT_RULE_ORDER.includes(value as ContentRuleId)
  );
}

export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface NormalizedPageSpec {
  name: string;
  url: string;
  readySelector?: string;
  consoleIgnore: readonly string[];
}

export interface NormalizedConfig {
  version: 1;
  configPath: string;
  pages: readonly NormalizedPageSpec[];
  viewports: readonly ViewportSpec[];
  timeoutMs: number;
  outputDir: string;
  formats: readonly ReportFormat[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CombinationContext {
  page: NormalizedPageSpec;
  viewport: ViewportSpec;
  sanitizedUrl: string;
}

export interface ReadinessDeadline {
  readonly expiresAt: number;
}

export interface FindingDraft {
  ruleId: RuleId;
  severity: 'error';
  message: string;
  selector: string;
  evidence: FindingEvidence;
  identity: readonly (string | number)[];
}

export interface Finding extends Omit<FindingDraft, 'identity'> {
  page: string;
  url: string;
  viewport: ViewportSpec;
  fingerprint: `sha256:${string}`;
}

export interface RuleEvaluation {
  findings: readonly FindingDraft[];
  omittedFindingCount: number;
}

export interface CombinationResult {
  findings: readonly Finding[];
  suppressedConsoleCount: number;
  omitted: readonly { ruleId: ContentRuleId; count: number }[];
  readinessFailed: boolean;
}

export interface TextSink {
  // The shared sink contract intentionally accepts Node streams and void-returning test sinks.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  write(chunk: string): boolean | void;
}

export interface CliEnvironment {
  cwd: string;
  env: Readonly<NodeJS.ProcessEnv>;
  stdout: TextSink;
  stderr: TextSink;
}

export interface CliRunResult {
  exitCode: ExitCode;
  findingCount: number;
  outputDir?: string;
  jsonPath?: string;
  sarifPath?: string;
}

export interface AuditResult {
  schemaVersion: 1;
  complete: boolean;
  tool: { name: 'viewport-sentinel'; version: string };
  browser: { name: 'chromium'; playwrightVersion: string; version: string };
  config: {
    version: 1;
    pages: readonly {
      name: string;
      url: string;
      hasReadySelector: boolean;
      consoleIgnoreCount: number;
    }[];
    viewports: readonly ViewportSpec[];
    timeoutMs: number;
    formats: readonly ReportFormat[];
  };
  combinations: { total: number; completed: number; failedReadiness: number };
  totals: {
    findingCount: number;
    suppressedConsoleCount: number;
    omittedFindingCount: number;
    omittedByCombination: readonly {
      page: string;
      viewport: string;
      ruleId: ContentRuleId;
      count: number;
    }[];
  };
  findings: readonly Finding[];
}

export type FindingEvidence =
  | {
      kind: 'overflow';
      viewportWidth: number;
      documentWidth: number;
      overflowPx: number;
      offenders: readonly { selector: string; rect: Rect }[];
    }
  | {
      kind: 'overlap';
      coverSelector: string;
      targetSelector: string;
      coverRect: Rect;
      targetRect: Rect;
      overlapRatio: number;
      centerCovered: boolean;
    }
  | {
      kind: 'image';
      selector: string;
      currentSrc: string;
      sourceCandidates: readonly string[];
      complete: boolean;
      naturalWidth: number;
      naturalHeight: number;
      decode: 'resolved' | 'rejected' | 'timeout';
    }
  | {
      kind: 'console';
      eventType: 'console.error' | 'pageerror';
      message: string;
      sourceUrl: string;
      line: number;
      column: number;
    }
  | {
      kind: 'runtime';
      stage: ReadinessStage;
      message: string;
    };
