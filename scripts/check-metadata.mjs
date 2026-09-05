import { readFile } from 'node:fs/promises';

const artifactPath = 'dist/chatgpt-autopilot.user.js';
const source = await readFile(artifactPath, 'utf8');
const headerEnd = source.indexOf('// ==/UserScript==');

if (headerEnd === -1) {
  throw new Error('Userscript metadata block is missing or malformed.');
}

const header = source.slice(0, headerEnd + '// ==/UserScript=='.length);
const requiredLines = [
  '// @name         ChatGPT Autopilot',
  '// @namespace    https://github.com/ShapArt/Auto-Chat',
  '// @version      0.1.0',
  '// @description  Privacy-first, project-aware continuation autopilot for ChatGPT.',
  '// @author       ShapArt',
  '// @license      MIT',
  '// @match        https://chatgpt.com/*',
  '// @run-at       document-idle',
];

for (const line of requiredLines) {
  if (!header.includes(line)) throw new Error(`Missing required metadata line: ${line}`);
}

const forbidden = [
  { pattern: /@match\s+\*:\/\/\*\/\*/, label: 'wildcard @match' },
  { pattern: /\bunsafeWindow\b/, label: 'unsafeWindow' },
  { pattern: /\bGM_xmlhttpRequest\b/, label: 'GM_xmlhttpRequest' },
  { pattern: /@require\b/, label: '@require' },
];

for (const { pattern, label } of forbidden) {
  if (pattern.test(header))
    throw new Error(`Forbidden userscript capability in metadata: ${label}`);
}

const grants = [...header.matchAll(/^\/\/\s*@grant\s+([^\s]+)\s*$/gm)].map((match) => match[1]);
const expectedGrants = ['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand'];

if (grants.length !== expectedGrants.length) {
  throw new Error(`Expected exactly ${expectedGrants.length} grants, found ${grants.length}.`);
}

for (const grant of expectedGrants) {
  if (!grants.includes(grant)) throw new Error(`Missing required grant: ${grant}`);
}

for (const grant of grants) {
  if (!expectedGrants.includes(grant)) throw new Error(`Unexpected grant: ${grant}`);
}

console.log('Userscript metadata check passed.');
