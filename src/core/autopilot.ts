import { transition } from './state-machine';
import type { AutopilotState } from './types';
import {
  buildContinuationPrompt,
  createSessionIdentity,
  type SessionIdentity,
} from '../navigation/project-navigator';
import type { AutopilotSettings } from '../settings/settings';
import { Logger } from '../utils/logger';

export interface AutopilotDomAdapter {
  isGenerating(): boolean;
  isComposerEmpty(): boolean;
  canSubmit(): boolean;
  insertComposerText(text: string): boolean;
  submitPrompt(): boolean;
  observeRelevantActivity(callback: () => void): () => void;
}

export interface AutopilotSnapshot {
  state: AutopilotState;
  enabled: boolean;
  pauseReason: string | null;
  errorReason: string | null;
  generationEpoch: number;
  submittedEpoch: number;
  successfulTurns: number;
  sessionId: string;
  rolloverIndex: number;
}

export interface AutopilotOptions {
  getConversationKey?: () => string;
  onStateChange?: (snapshot: AutopilotSnapshot) => void;
  logger?: Logger;
  sessionIdentity?: SessionIdentity;
}

export class Autopilot {
  private state: AutopilotState = 'DISABLED';
  private enabled = false;
  private pauseReason: string | null = null;
  private errorReason: string | null = null;
  private generationEpoch = 0;
  private submittedEpoch = -1;
  private successfulTurns = 0;
  private conversationKey = '';
  private started = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private postSubmitTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectObserver: (() => void) | null = null;
  private readonly getConversationKey: () => string;
  private readonly onStateChange: ((snapshot: AutopilotSnapshot) => void) | undefined;
  private readonly logger: Logger;
  private readonly sessionIdentity: SessionIdentity;

  constructor(
    private readonly adapter: AutopilotDomAdapter,
    private readonly settings: AutopilotSettings,
    options: AutopilotOptions = {},
  ) {
    this.getConversationKey =
      options.getConversationKey ?? (() => globalThis.location?.pathname ?? '');
    this.onStateChange = options.onStateChange;
    this.logger = options.logger ?? new Logger(settings.debug);
    this.sessionIdentity = options.sessionIdentity ?? createSessionIdentity();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.disconnectObserver = this.adapter.observeRelevantActivity(() => this.evaluate());
    this.watchdogTimer = setInterval(() => this.evaluate(), this.settings.watchdogMs);
  }

  stop(): void {
    this.disable();
    this.disconnectObserver?.();
    this.disconnectObserver = null;
    if (this.watchdogTimer !== null) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    this.started = false;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.pauseReason = null;
    this.errorReason = null;
    this.conversationKey = this.getConversationKey();
    this.setState(transition(this.state, { type: 'ENABLE' }));
    this.evaluate();
  }

  disable(): void {
    this.enabled = false;
    this.pauseReason = null;
    this.errorReason = null;
    this.cancelAutomationTimers();
    this.setState(transition(this.state, { type: 'DISABLE' }));
  }

  pause(reason: string): void {
    if (this.state === 'DISABLED') return;
    this.cancelAutomationTimers();
    this.pauseReason = reason;
    this.errorReason = null;
    this.setState(transition(this.state, { type: 'PAUSE' }));
  }

  getSnapshot(): AutopilotSnapshot {
    return {
      state: this.state,
      enabled: this.enabled,
      pauseReason: this.pauseReason,
      errorReason: this.errorReason,
      generationEpoch: this.generationEpoch,
      submittedEpoch: this.submittedEpoch,
      successfulTurns: this.successfulTurns,
      sessionId: this.sessionIdentity.sessionId,
      rolloverIndex: this.sessionIdentity.rolloverIndex,
    };
  }

  private evaluate(): void {
    if (!this.enabled) return;
    if (this.state === 'DISABLED' || this.state === 'PAUSED' || this.state === 'ERROR') return;

    if (this.getConversationKey() !== this.conversationKey) {
      this.pause('conversation changed');
      return;
    }

    if (this.isManualInputSensitiveState() && !this.adapter.isComposerEmpty()) {
      this.pause('manual input detected');
      return;
    }

    const generating = this.adapter.isGenerating();

    if (generating) {
      this.cancelPostSubmitTimer();

      if (this.state === 'ARMED') {
        this.generationEpoch += 1;
        this.setState(transition(this.state, { type: 'GENERATION_STARTED' }));
      } else if (this.state === 'COOLDOWN') {
        this.generationEpoch += 1;
        this.setState(transition(this.state, { type: 'NEXT_GENERATION_STARTED' }));
      } else if (this.state === 'SETTLING') {
        this.cancelSettleTimer();
        this.setState(transition(this.state, { type: 'GENERATION_STARTED' }));
      }
      return;
    }

    if (this.state === 'GENERATING') {
      this.setState(transition(this.state, { type: 'GENERATION_STOPPED' }));
      this.scheduleSettlement(this.generationEpoch);
    }
  }

  private scheduleSettlement(epoch: number): void {
    if (this.settleTimer !== null) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.finishSettlement(epoch);
    }, this.settings.completionDebounceMs);
  }

  private finishSettlement(epoch: number): void {
    if (!this.enabled || this.state !== 'SETTLING' || epoch !== this.generationEpoch) return;

    if (this.getConversationKey() !== this.conversationKey) {
      this.pause('conversation changed');
      return;
    }

    if (this.adapter.isGenerating()) {
      this.setState(transition(this.state, { type: 'GENERATION_STARTED' }));
      return;
    }

    if (!this.adapter.isComposerEmpty()) {
      this.pause('manual input detected');
      return;
    }

    this.setState(transition(this.state, { type: 'SETTLED' }));

    if (
      this.settings.sessionTurnLimit > 0 &&
      this.successfulTurns >= this.settings.sessionTurnLimit
    ) {
      this.pause('session turn limit reached');
      return;
    }

    this.submitContinuation(epoch);
  }

  private submitContinuation(epoch: number): void {
    if (!this.enabled || this.state !== 'READY') return;
    if (this.submittedEpoch === epoch) return;

    if (!this.adapter.isComposerEmpty()) {
      this.pause('manual input detected');
      return;
    }

    const continuationPrompt = buildContinuationPrompt(
      this.settings,
      this.successfulTurns,
      this.sessionIdentity,
    );

    this.submittedEpoch = epoch;
    this.setState(transition(this.state, { type: 'SUBMIT_STARTED' }));

    if (!this.adapter.insertComposerText(continuationPrompt)) {
      if (!this.adapter.isComposerEmpty()) this.pause('manual input detected');
      else this.fail('continuation insertion failed');
      return;
    }

    if (!this.adapter.canSubmit() || !this.adapter.submitPrompt()) {
      this.fail('submission failed');
      return;
    }

    this.successfulTurns += 1;
    this.setState(transition(this.state, { type: 'SUBMIT_SUCCEEDED' }));
    this.schedulePostSubmitGuard();
  }

  private schedulePostSubmitGuard(): void {
    this.cancelPostSubmitTimer();
    this.postSubmitTimer = setTimeout(() => {
      this.postSubmitTimer = null;
      if (!this.enabled || this.state !== 'COOLDOWN') return;
      if (this.adapter.isGenerating()) {
        this.evaluate();
        return;
      }
      this.fail('generation did not start after submission');
    }, this.settings.postSubmitGuardMs);
  }

  private fail(reason: string): void {
    this.cancelAutomationTimers();
    this.pauseReason = null;
    this.errorReason = reason;
    this.setState(transition(this.state, { type: 'FAIL' }));
  }

  private isManualInputSensitiveState(): boolean {
    return (
      this.state === 'ARMED' ||
      this.state === 'GENERATING' ||
      this.state === 'SETTLING' ||
      this.state === 'READY'
    );
  }

  private cancelAutomationTimers(): void {
    this.cancelSettleTimer();
    this.cancelPostSubmitTimer();
  }

  private cancelSettleTimer(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  private cancelPostSubmitTimer(): void {
    if (this.postSubmitTimer !== null) clearTimeout(this.postSubmitTimer);
    this.postSubmitTimer = null;
  }

  private setState(next: AutopilotState): void {
    if (next === this.state) return;
    const previous = this.state;
    this.state = next;
    this.logger.debug(`state ${previous} -> ${next}`, {
      epoch: this.generationEpoch,
      successfulTurns: this.successfulTurns,
    });
    this.onStateChange?.(this.getSnapshot());
  }
}
