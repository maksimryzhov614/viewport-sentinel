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
      /\[!\[[^\]]+\]\(\s*(docs\/assets\/demo\.gif)\s*\)\]\(\s*(https:\/\/github\.com\/maksimryzhov614\/viewport-sentinel\/actions\/runs\/30747735855)\s*\)/u.exec(
        normalizedReadme,
      );
    const imageIndex = linkedImage?.index ?? -1;

    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(warningIndex).toBeGreaterThan(headingIndex);
    expect(imageIndex).toBeGreaterThan(warningIndex);
    expect(linkedImage?.[1]).toBe('docs/assets/demo.gif');
    expect(linkedImage?.[2]).toBe(
      'https://github.com/maksimryzhov614/viewport-sentinel/actions/runs/30747735855',
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
    expect(warning).toContain('project ci is passing');
    expect(normalizedReadme).not.toContain('## Verified demo');
  });
});
