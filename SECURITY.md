# Security policy

## Reporting a vulnerability

Please report vulnerabilities through a private GitHub Security Advisory for
`maksimryzhov614/viewport-sentinel`. Do not open a public issue for a suspected
vulnerability or include exploit details in a public reproduction.

No supported-release window is promised before the first public release.
Security fixes will be assessed and documented case by case.

## Report data

JSON, SARIF, terminal output, annotations, and summaries can contain sanitized
target URLs and normalized page messages. URL credentials, query strings, and
fragments are removed, but remaining paths, selectors, and message text can
still be sensitive. Review artifacts before sharing them and never include
secrets, signed URLs, customer data, or private reproductions in an issue.
