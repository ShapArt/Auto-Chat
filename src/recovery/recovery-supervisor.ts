import type { UiErrorKind } from './error-classifier';

export type RecoveryState =
  | 'NORMAL'
  | 'GENERATING'
  | 'SAFETY_CHECK_WAIT'
  | 'SUSPECT_STALL'
  | 'STALLED'
  | 'STOPPING'
  | 'REGENERATING'
  | 'RECOVERY_WAIT'
  | 'RELOADING'
  | 'RESTORING_AFTER_RELOAD'
  | 'GENERATION_ERROR'
  | 'SERVICE_RESTRICTION'
  | 'CONVERSATION_EXHAUSTED'
  | 'ROLLOVER_PREP'
  | 'CREATING_NEW_CHAT'
  | 'RESUMING_PROJECT_CONTEXT'
  | 'ROLLOVER_VALIDATION'
  | 'PAUSED_NETWORK'
  | 'PAUSED'
  | 'FATAL';

export interface RecoverySettings {
  softStallTimeoutMs: number;
  hardStallTimeoutMs: number;
  onlineSettleMs: number;
  maxRegeneratesPerTurn: number;
  maxReloadsPerWindow: number;
  reloadWindowMs: number;
  maxRecoveryFailures: number;
}

export const DEFAULT_RECOVERY_SETTINGS: Readonly<RecoverySettings> = Object.freeze({
  softStallTimeoutMs: 180_000,
  hardStallTimeoutMs: 600_000,
  onlineSettleMs: 1_500,
  maxRegeneratesPerTurn: 1,
  maxReloadsPerWindow: 2,
  reloadWindowMs: 900_000,
  maxRecoveryFailures: 3,
});

export interface RecoveryActions {
  stopGeneration(): boolean;
  regenerate(): boolean;
  reload(): void;
  rollover(): boolean;
  pause(reason: string): void;
}

export interface RecoverySnapshot {
  state: RecoveryState;
  online: boolean;
  generationActive: boolean;
  currentError: UiErrorKind | null;
  generationStartedAt: number | null;
  lastRelevantDomActivityAt: number | null;
  lastStateChangeAt: number | null;
  lastRecoveryAt: number | null;
  lastReloadAt: number | null;
  lastSuccessfulCompletionAt: number | null;
  regeneratesThisTurn: number;
  recoveryFailures: number;
  reloadsInWindow: number;
}

const TERMINAL_RESTRICTIONS = new Set<UiErrorKind>([
  'RATE_LIMIT',
  'USAGE_LIMIT',
  'LOGIN_REQUIRED',
  'VERIFICATION_REQUIRED',
]);

const RECOVERABLE_ERRORS = new Set<UiErrorKind>([
  'GENERATION_FAILED',
  'NETWORK_ERROR',
  'WEBSOCKET_ERROR',
  'COMPOSER_UNAVAILABLE',
  'PAGE_BROKEN',
  'SCRIPT_INCOMPATIBLE',
]);

export class RecoverySupervisor {
  private state: RecoveryState = 'NORMAL';
  private online = true;
  private generationActive = false;
  private currentError: UiErrorKind | null = null;
  private generationStartedAt: number | null = null;
  private lastRelevantDomActivityAt: number | null = null;
  private lastStateChangeAt: number | null = null;
  private lastRecoveryAt: number | null = null;
  private lastReloadAt: number | null = null;
  private lastSuccessfulCompletionAt: number | null = null;
  private regeneratesThisTurn = 0;
  private recoveryFailures = 0;
  private readonly reloadTimestamps: number[] = [];
  private onlineResumeAt: number | null = null;

  constructor(
    private readonly settings: RecoverySettings,
    private readonly actions: RecoveryActions,
  ) {}

  onGenerationStarted(now: number): void {
    if (this.isTerminalState()) return;
    this.generationActive = true;
    this.currentError = null;
    this.generationStartedAt = now;
    this.lastRelevantDomActivityAt = now;
    this.setState('GENERATING', now);
  }

  onRelevantActivity(now: number): void {
    this.lastRelevantDomActivityAt = now;
    if (this.state === 'SUSPECT_STALL' && this.generationActive) {
      this.setState('GENERATING', now);
    }
  }

  onGenerationFinished(now: number): void {
    this.generationActive = false;
    this.currentError = null;
    this.generationStartedAt = null;
    this.lastRelevantDomActivityAt = now;
    this.lastSuccessfulCompletionAt = now;
    this.regeneratesThisTurn = 0;
    this.recoveryFailures = 0;
    this.onlineResumeAt = null;
    if (!this.isTerminalState()) this.setState('NORMAL', now);
  }

  observeError(kind: UiErrorKind | null, now: number): void {
    const previousError = this.currentError;
    this.currentError = kind;

    if (kind !== null && kind === previousError) return;

    if (kind === null) {
      if (this.state === 'SAFETY_CHECK_WAIT' && this.generationActive) {
        this.setState('GENERATING', now);
      }
      return;
    }

    if (kind === 'SAFETY_CHECK') {
      if (!this.isTerminalState()) this.setState('SAFETY_CHECK_WAIT', now);
      return;
    }

    if (TERMINAL_RESTRICTIONS.has(kind)) {
      this.pauseTerminal(`service restriction: ${kind.toLowerCase()}`, now);
      return;
    }

    if (kind === 'CONVERSATION_LIMIT') {
      this.setState('CONVERSATION_EXHAUSTED', now);
      return;
    }

    if (RECOVERABLE_ERRORS.has(kind) || kind === 'STALLED' || kind === 'UNKNOWN') {
      this.recoveryFailures += 1;
      if (this.recoveryFailures >= this.settings.maxRecoveryFailures) {
        this.tripCircuitBreaker(now);
        return;
      }
      this.setState(kind === 'STALLED' ? 'STALLED' : 'GENERATION_ERROR', now);
    }
  }

  setOnline(online: boolean, now: number): void {
    if (this.online === online) return;
    this.online = online;

    if (!online) {
      this.onlineResumeAt = null;
      this.actions.pause('network offline');
      this.setState('PAUSED_NETWORK', now);
      return;
    }

    if (this.state === 'PAUSED_NETWORK') {
      this.onlineResumeAt = now + this.settings.onlineSettleMs;
      this.setState('RECOVERY_WAIT', now);
    }
  }

  tick(now: number): void {
    if (this.state === 'FATAL' || this.state === 'PAUSED') return;
    if (!this.online || this.state === 'PAUSED_NETWORK') return;
    if (this.currentError === 'SAFETY_CHECK' || this.state === 'SAFETY_CHECK_WAIT') return;
    if (TERMINAL_RESTRICTIONS.has(this.currentError as UiErrorKind)) return;

    if (this.state === 'RECOVERY_WAIT' && this.onlineResumeAt !== null) {
      if (now < this.onlineResumeAt) return;
      this.onlineResumeAt = null;
      this.setState(this.generationActive ? 'GENERATING' : 'NORMAL', now);
      return;
    }

    if (!this.generationActive) return;
    if (this.state !== 'GENERATING' && this.state !== 'SUSPECT_STALL') return;

    const lastActivity = this.lastRelevantDomActivityAt ?? this.generationStartedAt ?? now;
    const inactiveFor = Math.max(0, now - lastActivity);

    if (inactiveFor >= this.settings.hardStallTimeoutMs) {
      this.setState('STALLED', now);
      this.lastRecoveryAt = now;
      const stopped = this.actions.stopGeneration();
      if (stopped) this.setState('STOPPING', now);
      else this.recordRecoveryFailure(now);
      return;
    }

    if (inactiveFor >= this.settings.softStallTimeoutMs && this.state === 'GENERATING') {
      this.setState('SUSPECT_STALL', now);
    }
  }

  requestRegenerate(now: number): boolean {
    if (!this.canRecover()) return false;
    if (this.regeneratesThisTurn >= this.settings.maxRegeneratesPerTurn) return false;

    this.lastRecoveryAt = now;
    const started = this.actions.regenerate();
    if (!started) {
      this.recordRecoveryFailure(now);
      return false;
    }

    this.regeneratesThisTurn += 1;
    this.setState('REGENERATING', now);
    return true;
  }

  requestReload(now: number): boolean {
    if (!this.canRecover()) return false;
    this.pruneReloadWindow(now);

    if (this.reloadTimestamps.length >= this.settings.maxReloadsPerWindow) {
      this.tripCircuitBreaker(now);
      return false;
    }

    this.reloadTimestamps.push(now);
    this.lastReloadAt = now;
    this.lastRecoveryAt = now;
    this.setState('RELOADING', now);
    this.actions.reload();
    return true;
  }

  requestRollover(now: number): boolean {
    if (!this.canRecover() || this.state === 'SAFETY_CHECK_WAIT') return false;
    this.lastRecoveryAt = now;
    this.setState('ROLLOVER_PREP', now);
    const started = this.actions.rollover();
    if (!started) {
      this.recordRecoveryFailure(now);
      return false;
    }
    this.setState('CREATING_NEW_CHAT', now);
    return true;
  }

  markRestoringAfterReload(now: number): void {
    if (this.state === 'FATAL' || this.state === 'PAUSED') return;
    this.setState('RESTORING_AFTER_RELOAD', now);
  }

  onAutomationDisabled(now: number): void {
    this.generationActive = false;
    this.currentError = null;
    this.generationStartedAt = null;
    this.lastRelevantDomActivityAt = null;
    this.regeneratesThisTurn = 0;
    this.recoveryFailures = 0;
    this.onlineResumeAt = null;
    if (this.state !== 'FATAL') this.setState('NORMAL', now);
  }

  resetRecovery(now = Date.now()): void {
    this.regeneratesThisTurn = 0;
    this.recoveryFailures = 0;
    this.reloadTimestamps.length = 0;
    this.currentError = null;
    this.onlineResumeAt = null;
    this.setState(this.generationActive ? 'GENERATING' : 'NORMAL', now);
  }

  getSnapshot(): RecoverySnapshot {
    const now = this.lastStateChangeAt ?? 0;
    this.pruneReloadWindow(now);
    return {
      state: this.state,
      online: this.online,
      generationActive: this.generationActive,
      currentError: this.currentError,
      generationStartedAt: this.generationStartedAt,
      lastRelevantDomActivityAt: this.lastRelevantDomActivityAt,
      lastStateChangeAt: this.lastStateChangeAt,
      lastRecoveryAt: this.lastRecoveryAt,
      lastReloadAt: this.lastReloadAt,
      lastSuccessfulCompletionAt: this.lastSuccessfulCompletionAt,
      regeneratesThisTurn: this.regeneratesThisTurn,
      recoveryFailures: this.recoveryFailures,
      reloadsInWindow: this.reloadTimestamps.length,
    };
  }

  private recordRecoveryFailure(now: number): void {
    this.recoveryFailures += 1;
    if (this.recoveryFailures >= this.settings.maxRecoveryFailures) {
      this.tripCircuitBreaker(now);
    }
  }

  private tripCircuitBreaker(now: number): void {
    if (this.state === 'FATAL') return;
    this.actions.pause('recovery circuit breaker tripped');
    this.setState('FATAL', now);
  }

  private pauseTerminal(reason: string, now: number): void {
    if (this.state === 'PAUSED' || this.state === 'FATAL') return;
    this.setState('SERVICE_RESTRICTION', now);
    this.actions.pause(reason);
    this.setState('PAUSED', now);
  }

  private canRecover(): boolean {
    return (
      this.online &&
      this.state !== 'FATAL' &&
      this.state !== 'PAUSED' &&
      this.state !== 'PAUSED_NETWORK' &&
      this.state !== 'SAFETY_CHECK_WAIT' &&
      !TERMINAL_RESTRICTIONS.has(this.currentError as UiErrorKind)
    );
  }

  private pruneReloadWindow(now: number): void {
    const oldestAllowed = now - this.settings.reloadWindowMs;
    while (this.reloadTimestamps.length > 0 && this.reloadTimestamps[0]! < oldestAllowed) {
      this.reloadTimestamps.shift();
    }
  }

  private isTerminalState(): boolean {
    return this.state === 'FATAL' || this.state === 'PAUSED';
  }

  private setState(state: RecoveryState, now: number): void {
    if (this.state === state) return;
    this.state = state;
    this.lastStateChangeAt = now;
  }
}
