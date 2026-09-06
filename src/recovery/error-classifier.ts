export type UiErrorKind =
  | 'UNKNOWN'
  | 'GENERATION_FAILED'
  | 'NETWORK_ERROR'
  | 'WEBSOCKET_ERROR'
  | 'STALLED'
  | 'SAFETY_CHECK'
  | 'RATE_LIMIT'
  | 'USAGE_LIMIT'
  | 'LOGIN_REQUIRED'
  | 'VERIFICATION_REQUIRED'
  | 'CONVERSATION_LIMIT'
  | 'COMPOSER_UNAVAILABLE'
  | 'PAGE_BROKEN'
  | 'SCRIPT_INCOMPATIBLE';

export interface RecoveryUiSignals {
  safetyCheck: boolean;
  generationFailed: boolean;
  networkError: boolean;
  websocketError: boolean;
  rateLimit: boolean;
  usageLimit: boolean;
  loginRequired: boolean;
  verificationRequired: boolean;
  conversationLimit: boolean;
  composerUnavailable: boolean;
  pageBroken: boolean;
  scriptIncompatible: boolean;
}

export const EMPTY_UI_SIGNALS: Readonly<RecoveryUiSignals> = Object.freeze({
  safetyCheck: false,
  generationFailed: false,
  networkError: false,
  websocketError: false,
  rateLimit: false,
  usageLimit: false,
  loginRequired: false,
  verificationRequired: false,
  conversationLimit: false,
  composerUnavailable: false,
  pageBroken: false,
  scriptIncompatible: false,
});

/**
 * Maps already-observed UI signals to a technical classification.
 * This layer intentionally does not read assistant response content.
 * Structural selectors and any text fallbacks belong in the ChatGPT DOM adapter.
 */
export function classifyUiError(signals: RecoveryUiSignals): UiErrorKind | null {
  if (signals.verificationRequired) return 'VERIFICATION_REQUIRED';
  if (signals.loginRequired) return 'LOGIN_REQUIRED';
  if (signals.usageLimit) return 'USAGE_LIMIT';
  if (signals.rateLimit) return 'RATE_LIMIT';
  if (signals.safetyCheck) return 'SAFETY_CHECK';
  if (signals.conversationLimit) return 'CONVERSATION_LIMIT';
  if (signals.pageBroken) return 'PAGE_BROKEN';
  if (signals.scriptIncompatible) return 'SCRIPT_INCOMPATIBLE';
  if (signals.composerUnavailable) return 'COMPOSER_UNAVAILABLE';
  if (signals.websocketError) return 'WEBSOCKET_ERROR';
  if (signals.networkError) return 'NETWORK_ERROR';
  if (signals.generationFailed) return 'GENERATION_FAILED';
  return null;
}
