import { describe, expect, it } from 'vitest';
import {
  classifyUiError,
  EMPTY_UI_SIGNALS,
  type RecoveryUiSignals,
} from '../../src/recovery/error-classifier';

function signals(overrides: Partial<RecoveryUiSignals>): RecoveryUiSignals {
  return { ...EMPTY_UI_SIGNALS, ...overrides };
}

describe('classifyUiError', () => {
  it('returns null for a healthy UI snapshot', () => {
    expect(classifyUiError(signals({}))).toBeNull();
  });

  it('prioritizes terminal restrictions over recoverable generation errors', () => {
    expect(classifyUiError(signals({ rateLimit: true, generationFailed: true }))).toBe(
      'RATE_LIMIT',
    );
    expect(classifyUiError(signals({ usageLimit: true, generationFailed: true }))).toBe(
      'USAGE_LIMIT',
    );
    expect(classifyUiError(signals({ verificationRequired: true, networkError: true }))).toBe(
      'VERIFICATION_REQUIRED',
    );
  });

  it('recognizes the structural safety-check signal before generic failures', () => {
    expect(classifyUiError(signals({ safetyCheck: true, generationFailed: true }))).toBe(
      'SAFETY_CHECK',
    );
  });

  it('maps visible recoverable states without inspecting assistant output', () => {
    expect(classifyUiError(signals({ generationFailed: true }))).toBe('GENERATION_FAILED');
    expect(classifyUiError(signals({ networkError: true }))).toBe('NETWORK_ERROR');
    expect(classifyUiError(signals({ websocketError: true }))).toBe('WEBSOCKET_ERROR');
    expect(classifyUiError(signals({ conversationLimit: true }))).toBe('CONVERSATION_LIMIT');
    expect(classifyUiError(signals({ composerUnavailable: true }))).toBe('COMPOSER_UNAVAILABLE');
  });
});
