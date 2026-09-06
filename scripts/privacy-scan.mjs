import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURE_ROOT = 'tests/fixtures';
const RULES = [
  {
    name: 'email address',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    name: 'canonical UUID',
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  },
  {
    name: 'private/raw snapshot marker',
    pattern: /(?:raw[-_ ]?)?chatgpt[-_ ]?snapshot|private[-_ ]snapshot|conversation[-_ ]snapshot/i,
  },
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (entry.isFile()) files.push(path);
  }

  return files;
}

const files = await collectFiles(FIXTURE_ROOT);
const violations = [];

for (const path of files) {
  const content = await readFile(path, 'utf8');
  for (const rule of RULES) {
    if (rule.pattern.test(content)) violations.push(`${path}: ${rule.name}`);
  }
}

if (violations.length > 0) {
  console.error('Privacy scan failed. Potential sensitive material detected:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Privacy scan passed for ${files.length} committed fixture file(s).`);
}
