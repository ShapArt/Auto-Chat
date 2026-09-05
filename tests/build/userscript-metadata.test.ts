// @ts-expect-error Node builtin is used only by this build-metadata test; browser tsconfig intentionally omits Node types.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('userscript execution sandbox', () => {
  it('declares the DOM-only Tampermonkey sandbox instead of relying on MAIN_WORLD injection', async () => {
    const buildSource = await readFile('scripts/build.mjs', 'utf8');

    expect(buildSource).toContain('// @sandbox      DOM');
  });
});
