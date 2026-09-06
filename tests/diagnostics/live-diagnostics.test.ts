// @ts-expect-error Node built-in intentionally used by Vitest runtime only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/chatgpt-autopilot-live-diagnostics.user.js', 'utf8');

describe('live diagnostics recorder contract', () => {
  it('exposes diag.3 live-gate recorder controls and sanitized timeline fields', () => {
    expect(source).toContain('@version      0.1.0-diag.3');
    expect(source).toContain("diagVersion: '0.1.0-diag.3'");
    expect(source).toContain("'Start live gate'");
    expect(source).toContain("'Reset'");
    expect(source).toContain("'Copy report'");
    expect(source).toContain('timeline');
    expect(source).toContain('routeKind');
    expect(source).toContain('sameProject');
    expect(source).toContain('sendClicks');
    expect(source).toContain('composerNonEmpty');
  });

  it('keeps the exported report structural and free of private account/session surfaces', () => {
    expect(source).not.toContain('hrefPath:');
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('indexedDB');
    expect(source).not.toContain('unsafeWindow');
    expect(source).not.toContain('GM_xmlhttpRequest');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('WebSocket');
  });

  it('ignores diagnostic panel mutations so rendering cannot self-trigger the observer', () => {
    expect(source).toContain('root.contains(mutation.target)');
  });
});
