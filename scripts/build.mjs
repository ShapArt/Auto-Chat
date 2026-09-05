import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         ChatGPT Autopilot
// @namespace    https://github.com/ShapArt/Auto-Chat
// @version      0.1.0
// @description  Privacy-first, project-aware continuation autopilot for ChatGPT.
// @author       ShapArt
// @license      MIT
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==`;

await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['firefox115'],
  outfile: 'dist/chatgpt-autopilot.user.js',
  sourcemap: false,
  legalComments: 'none',
  charset: 'utf8',
  banner: { js: USERSCRIPT_HEADER },
});
