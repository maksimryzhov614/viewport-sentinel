import * as core from '@actions/core';
import { normalizeMessage } from '../core/privacy.js';
import type { AuditResult, Finding } from '../model/types.js';

const MAX_DISPLAYED_FINDINGS = 50;

export type GitHubReporterEnvironment = Readonly<NodeJS.ProcessEnv>;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHtml(value: string): string {
  return escapeHtml(normalizeMessage(value));
}

function annotationMessage(finding: Finding): string {
  return (
    `${finding.ruleId} ${normalizeMessage(finding.page)}/` +
    `${normalizeMessage(finding.viewport.name)} ` +
    `${normalizeMessage(finding.selector)}: ${normalizeMessage(finding.message)}`
  );
}

function groupedFindings(
  findings: readonly Finding[],
): Map<string, Map<string, Finding[]>> {
  const pages = new Map<string, Map<string, Finding[]>>();
  for (const finding of findings) {
    let viewports = pages.get(finding.page);
    if (viewports === undefined) {
      viewports = new Map<string, Finding[]>();
      pages.set(finding.page, viewports);
    }
    let viewportFindings = viewports.get(finding.viewport.name);
    if (viewportFindings === undefined) {
      viewportFindings = [];
      viewports.set(finding.viewport.name, viewportFindings);
    }
    viewportFindings.push(finding);
  }
  return pages;
}

function summaryHtml(result: AuditResult): string {
  const displayedFindings = result.findings.slice(0, MAX_DISPLAYED_FINDINGS);
  const lines = [
    '<h1>Viewport Sentinel</h1>',
    '<p>',
    `Total findings: ${String(result.totals.findingCount)}<br>`,
    `Suppressed console messages: ${String(result.totals.suppressedConsoleCount)}<br>`,
    `Omitted findings: ${String(result.totals.omittedFindingCount)}`,
    '</p>',
  ];

  if (result.totals.findingCount === 0) {
    lines.push('<p>No findings detected.</p>');
  } else {
    for (const [page, viewports] of groupedFindings(displayedFindings)) {
      lines.push(`<h2>Page: ${safeHtml(page)}</h2>`);
      for (const [viewport, findings] of viewports) {
        lines.push(`<h3>Viewport: ${safeHtml(viewport)}</h3>`, '<ul>');
        for (const finding of findings) {
          lines.push(
            '<li>' +
              `<strong>${safeHtml(finding.ruleId)}</strong> ` +
              `<code>${safeHtml(finding.selector)}</code>: ` +
              `${safeHtml(finding.message)}</li>`,
          );
        }
        lines.push('</ul>');
      }
    }
  }

  const additionalFindingCount = Math.max(
    0,
    result.findings.length - displayedFindings.length,
  );
  if (additionalFindingCount > 0) {
    lines.push(
      `<p>${String(additionalFindingCount)} additional findings not shown.</p>`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export async function writeGitHubReport(
  result: AuditResult,
  relativeConfigPath: string,
  environment: GitHubReporterEnvironment,
): Promise<void> {
  for (const finding of result.findings.slice(0, MAX_DISPLAYED_FINDINGS)) {
    core.error(annotationMessage(finding), {
      file: relativeConfigPath,
      startLine: 1,
      endLine: 1,
      title: finding.ruleId,
    });
  }

  if (!environment.GITHUB_STEP_SUMMARY?.trim()) {
    core.warning(
      'GitHub step summary is unavailable; annotations were emitted.',
    );
    return;
  }

  core.summary.emptyBuffer().addRaw(summaryHtml(result));
  try {
    await core.summary.write();
  } finally {
    core.summary.emptyBuffer();
  }
}
