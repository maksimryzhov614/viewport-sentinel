import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { canonicalStringify } from '../core/canonical.js';
import { normalizeMessage, sanitizeUrl } from '../core/privacy.js';
import type {
  AuditResult,
  Finding,
  FindingEvidence,
  RuleId,
  ViewportSpec,
} from '../model/types.js';
import { AuditExecutionError } from '../runner/audit-config.js';

const RULES_BASE_URL =
  'https://github.com/maksimryzhov614/viewport-sentinel/blob/main/docs/rules.md';

interface SarifRule {
  id: RuleId;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
}

const ruleCatalog: readonly SarifRule[] = Object.freeze([
  {
    id: 'VSRUN001',
    name: 'PageReadinessFailure',
    shortDescription: { text: 'Page readiness failure' },
    fullDescription: {
      text: 'The page did not navigate or become ready before the configured deadline.',
    },
    helpUri: `${RULES_BASE_URL}#vsrun001`,
  },
  {
    id: 'VS001',
    name: 'HorizontalOverflow',
    shortDescription: { text: 'Horizontal overflow' },
    fullDescription: {
      text: 'The document is wider than the configured viewport.',
    },
    helpUri: `${RULES_BASE_URL}#vs001`,
  },
  {
    id: 'VS002',
    name: 'BlockedActionableControl',
    shortDescription: { text: 'Blocked actionable control' },
    fullDescription: {
      text: 'A fixed or sticky element obscures an actionable control.',
    },
    helpUri: `${RULES_BASE_URL}#vs002`,
  },
  {
    id: 'VS003',
    name: 'BrowserSelectedImageFailure',
    shortDescription: { text: 'Browser-selected image failure' },
    fullDescription: {
      text: 'A visible browser-selected image did not load and decode.',
    },
    helpUri: `${RULES_BASE_URL}#vs003`,
  },
  {
    id: 'VS004',
    name: 'BrowserRuntimeError',
    shortDescription: { text: 'Browser runtime error' },
    fullDescription: {
      text: 'The page emitted an unignored console error or page error.',
    },
    helpUri: `${RULES_BASE_URL}#vs004`,
  },
]);

interface SarifResult {
  ruleId: RuleId;
  level: 'error';
  message: { text: string };
  locations: readonly {
    physicalLocation: { artifactLocation: { uri: string } };
  }[];
  partialFingerprints: { primaryLocationLineHash: string };
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
    automationDetails: { id: 'viewport-sentinel/v1' };
    properties: { complete: boolean; configFile: string };
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

function toSarifResult(finding: Finding): SarifResult {
  return {
    ruleId: finding.ruleId,
    level: 'error',
    message: { text: normalizeMessage(finding.message) },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: sanitizeUrl(finding.url) },
        },
      },
    ],
    partialFingerprints: {
      primaryLocationLineHash: finding.fingerprint.slice('sha256:'.length),
    },
    properties: {
      page: finding.page,
      viewport: { ...finding.viewport },
      selector: finding.selector,
      evidence: finding.evidence,
    },
  };
}

export function toSarif(result: AuditResult, configFileName: string): SarifLog {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        automationDetails: { id: 'viewport-sentinel/v1' },
        properties: {
          complete: result.complete,
          configFile: basename(configFileName),
        },
        tool: {
          driver: {
            name: 'viewport-sentinel',
            version: result.tool.version,
            informationUri:
              'https://github.com/maksimryzhov614/viewport-sentinel',
            rules: ruleCatalog,
          },
        },
        results: result.findings.map(toSarifResult),
      },
    ],
  };
}

function incompleteResult(result: AuditResult): AuditResult {
  return result.complete ? { ...result, complete: false } : result;
}

export async function writeSarifReport(
  result: AuditResult,
  outputDir: string,
  configFileName: string,
): Promise<string> {
  const temporaryPath = join(outputDir, 'results.sarif.tmp');
  const reportPath = join(outputDir, 'results.sarif');

  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      temporaryPath,
      canonicalStringify(toSarif(result, configFileName)),
      'utf8',
    );
    await rename(temporaryPath, reportPath);
    return reportPath;
  } catch {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Cleanup is best-effort; the original reporter failure remains decisive.
    }
    throw new AuditExecutionError(
      incompleteResult(result),
      'Audit SARIF report writing failed',
      'SARIF reporter failed',
    );
  }
}
