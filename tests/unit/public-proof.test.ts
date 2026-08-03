import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '..', '..');
const proofRoot = join(repositoryRoot, 'docs', 'proof');

interface JsonProof {
  combinations?: { completed?: unknown; total?: unknown };
  complete?: unknown;
  findings?: unknown[];
  tool?: { version?: unknown };
  totals?: { findingCount?: unknown };
}

interface SarifProof {
  runs?: { results?: unknown[] }[];
  version?: unknown;
}

interface GifMetadata {
  durationSeconds: number;
  frames: number;
  height: number;
  width: number;
}

function skipSubBlocks(buffer: Buffer, start: number): number {
  let offset = start;
  while (offset < buffer.length) {
    const size = buffer[offset];
    if (size === undefined) throw new Error('Truncated GIF sub-block');
    offset += 1;
    if (size === 0) return offset;
    offset += size;
    if (offset > buffer.length) throw new Error('Truncated GIF sub-block data');
  }
  throw new Error('Unterminated GIF sub-blocks');
}

function parseGif(buffer: Buffer): GifMetadata {
  if (
    buffer.length < 14 ||
    !/^GIF8[79]a$/u.test(buffer.subarray(0, 6).toString('ascii'))
  ) {
    throw new Error('Invalid GIF header');
  }

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const globalTablePacked = buffer[10];
  if (globalTablePacked === undefined)
    throw new Error('Missing GIF descriptor');
  let offset = 13;
  if ((globalTablePacked & 0x80) !== 0) {
    offset += 3 * 2 ** ((globalTablePacked & 0x07) + 1);
  }

  let delayCentiseconds = 0;
  let frames = 0;
  while (offset < buffer.length) {
    const marker = buffer[offset];
    if (marker === 0x3b) break;

    if (marker === 0x21) {
      const label = buffer[offset + 1];
      if (label === 0xf9) {
        if (buffer[offset + 2] !== 4 || offset + 8 > buffer.length) {
          throw new Error('Invalid GIF Graphic Control Extension');
        }
        delayCentiseconds += buffer.readUInt16LE(offset + 4);
        offset += 8;
      } else {
        offset = skipSubBlocks(buffer, offset + 2);
      }
      continue;
    }

    if (marker === 0x2c) {
      if (offset + 10 > buffer.length) throw new Error('Truncated GIF image');
      frames += 1;
      const localTablePacked = buffer[offset + 9];
      if (localTablePacked === undefined)
        throw new Error('Missing GIF image flags');
      offset += 10;
      if ((localTablePacked & 0x80) !== 0) {
        offset += 3 * 2 ** ((localTablePacked & 0x07) + 1);
      }
      offset += 1;
      offset = skipSubBlocks(buffer, offset);
      continue;
    }

    throw new Error(`Unexpected GIF marker 0x${marker?.toString(16) ?? 'EOF'}`);
  }

  return {
    durationSeconds: delayCentiseconds / 100,
    frames,
    height,
    width,
  };
}

function expectPublicSafe(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/\/(?:Users|home)\//u);
  expect(serialized).not.toMatch(/(?:^|["'])[A-Za-z]:[\\/]/u);
  expect(serialized).not.toMatch(/file:\/\//iu);
  expect(serialized).not.toMatch(
    /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/u,
  );
  expect(serialized).not.toMatch(
    /https?:\/\/[^/\s"']+\.(?:internal|local)(?:[/:]|$)/iu,
  );
  expect(serialized).not.toMatch(
    /\b(?:credential|password|secret|access[_-]?token|api[_-]?key|authorization)\b/iu,
  );
  expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
  expect(serialized).not.toMatch(
    /"(?:timestamp|createdAt|startedAt|finishedAt)"\s*:/u,
  );
  expect(serialized).not.toMatch(
    /"(?:configFile|configPath|outputDir|outputPath)"\s*:\s*"(?:\/|[A-Za-z]:[\\/])/u,
  );
}

describe('committed public proof', () => {
  it('contains the complete deterministic six-finding JSON and SARIF reports', async () => {
    const [jsonSource, sarifSource] = await Promise.all([
      readFile(join(proofRoot, 'results.json'), 'utf8'),
      readFile(join(proofRoot, 'results.sarif'), 'utf8'),
    ]);
    const json = JSON.parse(jsonSource) as JsonProof;
    const sarif = JSON.parse(sarifSource) as SarifProof;

    expect(json.tool?.version).toBe('0.1.1');
    expect(json.complete).toBe(true);
    expect(json.combinations).toMatchObject({ completed: 10, total: 10 });
    expect(json.totals?.findingCount).toBe(6);
    expect(json.findings).toHaveLength(6);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs?.[0]?.results).toHaveLength(6);
    expectPublicSafe(json);
    expectPublicSafe(sarif);
  });

  it('keeps the real demo concise without depending on ffprobe in CI', async () => {
    const gif = parseGif(
      await readFile(join(repositoryRoot, 'docs/assets/demo.gif')),
    );

    expect(gif).toMatchObject({ width: 1200, height: 788 });
    expect(gif.frames).toBeGreaterThan(0);
    expect(gif.frames).toBeLessThanOrEqual(180);
    expect(gif.durationSeconds).toBeGreaterThanOrEqual(10);
    expect(gif.durationSeconds).toBeLessThanOrEqual(15);
  });
});
