# Changelog

All notable implemented changes are documented here.

## 0.1.0 - 2026-08-01

### Added

- Explicit page × viewport configuration with Node.js 22, 24, and 26 support.
- Serial, fresh-context Playwright Chromium audits for horizontal overflow,
  blocked actionable controls, browser-selected image failures, console errors,
  page errors, and page-readiness failures.
- Deterministic JSON and SARIF 2.1.0 reports with stable fingerprints, canonical
  ordering, bounded findings, URL sanitization, and partial-failure reporting.
- CLI exit codes `0`, `1`, and `2`, plus GitHub annotations and summaries.
- A fail-last composite GitHub Action that preserves report artifacts before
  propagating the audit result.
- Fixture-backed integration, deterministic-report, and performance gates.

### Limitations

- Chromium only; no Firefox, WebKit, or hosted browser service.
- Initial scroll position only; no crawling, interaction, authentication, or
  custom JavaScript execution.
- No Lighthouse, pixel-diff, Axe/accessibility, database, or telemetry feature.
- Document-tree inspection does not enter open or closed shadow roots.
- Below-fold lazy images are excluded from the initial snapshot.
