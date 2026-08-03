import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '..', '..');

describe('README detection demo', () => {
  it('explains the intentionally broken target before rendering the findings GIF', async () => {
    const readme = await readFile(join(repositoryRoot, 'README.md'), 'utf8');
    const normalizedReadme = readme
      .replace(/\r\n?/gu, '\n')
      .replace(/[ \t]+/gu, ' ');
    const headingIndex = normalizedReadme.search(
      /^##\s+Detection demo\s+—\s+intentionally broken fixture\s*$/mu,
    );
    const warningIndex = normalizedReadme.search(/^>\s*\[!IMPORTANT\]\s*$/mu);
    const linkedImage =
      /\[!\[[^\]]+\]\(\s*(docs\/assets\/demo\.gif)\s*\)\]\(\s*(https:\/\/github\.com\/maksimryzhov614\/viewport-sentinel\/actions\/runs\/30814151989)\s*\)/u.exec(
        normalizedReadme,
      );
    const imageIndex = linkedImage?.index ?? -1;

    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(warningIndex).toBeGreaterThan(headingIndex);
    expect(imageIndex).toBeGreaterThan(warningIndex);
    expect(linkedImage?.[1]).toBe('docs/assets/demo.gif');
    expect(linkedImage?.[2]).toBe(
      'https://github.com/maksimryzhov614/viewport-sentinel/actions/runs/30814151989',
    );

    const warning = normalizedReadme
      .slice(warningIndex, imageIndex)
      .replace(/^>\s?/gmu, '')
      .replace(/\s+/gu, ' ')
      .toLowerCase();
    expect(warning).toContain('expected findings');
    expect(warning).toMatch(/\bsix\b/u);
    expect(warning).toContain('intentionally broken');
    expect(warning).toMatch(/\b(?:target|fixture|test pages?)\b/u);
    expect(warning).toContain('the proof workflow succeeds');

    const demoSection = normalizedReadme
      .slice(headingIndex, normalizedReadme.indexOf('## Quick start'))
      .toLowerCase();
    expect(demoSection).not.toContain('final failure');
    expect(demoSection).not.toMatch(
      /proof workflow.{0,80}\b(?:fails?|failure)\b/u,
    );
    expect(normalizedReadme).not.toContain('## Verified demo');
    expect(normalizedReadme).toContain('[JSON proof](docs/proof/results.json)');
    expect(normalizedReadme).toContain(
      '[SARIF proof](docs/proof/results.sarif)',
    );
    expect(normalizedReadme).toContain(
      'https://github.com/maksimryzhov614/viewport-sentinel/actions/runs/30814151989',
    );
  });
});
