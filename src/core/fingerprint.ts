import { createHash } from 'node:crypto';
import type { CombinationContext, FindingDraft } from '../model/types.js';

export function fingerprintFor(
  context: CombinationContext,
  draft: FindingDraft,
): `sha256:${string}` {
  const payload = [
    1,
    draft.ruleId,
    context.page.name,
    context.sanitizedUrl,
    context.viewport.name,
    context.viewport.width,
    context.viewport.height,
    context.viewport.deviceScaleFactor,
    ...draft.identity,
  ];
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}
