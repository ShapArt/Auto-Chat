import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autopilot } from '../../src/core/autopilot';
import { DEFAULT_SETTINGS, type AutopilotSettings } from '../../src/settings/settings';

class FakeAdapter {
  generating = false;
  composerEmpty = true;
  canSubmitValue = true;
  insertSucceeds = true;
  submitSucceeds = true;
  inserted: string[] = [];
  submitCount = 0;
  private activityCallback: (() => void) | null = null;

  isGenerating(): boolean {
    return this.generating;
  }

  isComposerEmpty(): boolean {
    return this.composerEmpty;
  }

  canSubmit(): boolean {
    return this.canSubmitValue && !this.generating;
  }

  insertComposerText(text: string): boolean {
    if (!this.insertSucceeds || !this.composerEmpty) return false;
    this.inserted.push(text);
    this.composerEmpty = false;
    return true;
  }

  submitPrompt(): boolean {
    if (!this.submitSucceeds || !this.canSubmit()) return false;
    this.submitCount += 1;
    this.composerEmpty = true;
    return true;
  }

  observeRelevantActivity(callback: () => void): () => void {
    this.activityCallback = callback;
    return () => {
      if (this.activityCallback === callback) this.activityCallback = null;
    };
  }

  emitActivity(): void {
    this.activityCallback?.();
  }
}

function settings(overrides: Partial<AutopilotSettings> = {}): AutopilotSettings {
  return {
    ...DEFAULT_SETTINGS,
    completionDebounceMs: 100,
    postSubmitGuardMs: 250,
    watchdogMs: 1_000,
    ...overrides,
  };
}

function harness(overrides: Partial<AutopilotSettings> = {}) {
  const adapter = new FakeAdapter();
  let conversationKey = '/c/synthetic-a';
  const autopilot = new Autopilot(adapter, settings(overrides), {
    getConversationKey: () => conversationKey,
  });
  autopilot.start();
  return {
    adapter,
    autopilot,
    changeConversation: (key: string) => {
      conversationKey = key;
    },
  };
}

describe('Autopilot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms on idle and never immediately submits', () => {
    const { adapter, autopilot } = harness();

    autopilot.enable();
    vi.advanceTimersByTime(10_000);

    expect(autopilot.getSnapshot().state).toBe('ARMED');
    expect(adapter.submitCount).toBe(0);
  });

  it('captures an in-progress generation when enabled and waits for completion', () => {
    const { adapter, autopilot } = harness();
    adapter.generating = true;

    autopilot.enable();
    expect(autopilot.getSnapshot().state).toBe('GENERATING');
    expect(adapter.submitCount).toBe(0);

    adapter.generating = false;
    adapter.emitActivity();
    expect(autopilot.getSnapshot().state).toBe('SETTLING');

    vi.advanceTimersByTime(99);
    expect(adapter.submitCount).toBe(0);
    vi.advanceTimersByTime(1);

    expect(adapter.submitCount).toBe(1);
    expect(autopilot.getSnapshot().state).toBe('COOLDOWN');
  });

  it('submits exactly once for duplicate mutations in one generation epoch', () => {
    const { adapter, autopilot } = harness();
    autopilot.enable();

    adapter.generating = true;
    adapter.emitActivity();
    expect(autopilot.getSnapshot().state).toBe('GENERATING');

    adapter.generating = false;
    adapter.emitActivity();
    adapter.emitActivity();
    adapter.emitActivity();
    vi.advanceTimersByTime(100);

    expect(adapter.inserted).toHaveLength(1);
    expect(adapter.submitCount).toBe(1);

    adapter.emitActivity();
    adapter.emitActivity();
    expect(adapter.submitCount).toBe(1);
  });

  it('cancels a pending continuation immediately when disabled', () => {
    const { adapter, autopilot } = harness();
    autopilot.enable();
    adapter.generating = true;
    adapter.emitActivity();
    adapter.generating = false;
    adapter.emitActivity();

    autopilot.disable();
    vi.advanceTimersByTime(1_000);

    expect(autopilot.getSnapshot().state).toBe('DISABLED');
    expect(adapter.submitCount).toBe(0);
  });

  it('pauses instead of overwriting manual composer text', () => {
    const { adapter, autopilot } = harness();
    autopilot.enable();
    adapter.generating = true;
    adapter.emitActivity();

    adapter.composerEmpty = false;
    adapter.emitActivity();

    expect(autopilot.getSnapshot().state).toBe('PAUSED');
    expect(autopilot.getSnapshot().pauseReason).toBe('manual input detected');
    expect(adapter.inserted).toHaveLength(0);
  });

  it('pauses when the conversation context changes', () => {
    const { adapter, autopilot, changeConversation } = harness();
    autopilot.enable();

    changeConversation('/c/synthetic-b');
    adapter.emitActivity();

    expect(autopilot.getSnapshot().state).toBe('PAUSED');
    expect(autopilot.getSnapshot().pauseReason).toBe('conversation changed');
  });

  it('fails closed if the composer cannot submit at the completion boundary', () => {
    const { adapter, autopilot } = harness();
    autopilot.enable();
    adapter.generating = true;
    adapter.emitActivity();
    adapter.generating = false;
    adapter.emitActivity();
    adapter.canSubmitValue = false;

    vi.advanceTimersByTime(100);

    expect(autopilot.getSnapshot().state).toBe('ERROR');
    expect(adapter.submitCount).toBe(0);
  });

  it('uses a post-submit guard and errors rather than resubmitting if generation never starts', () => {
    const { adapter, autopilot } = harness();
    autopilot.enable();
    adapter.generating = true;
    adapter.emitActivity();
    adapter.generating = false;
    adapter.emitActivity();
    vi.advanceTimersByTime(100);

    expect(adapter.submitCount).toBe(1);
    vi.advanceTimersByTime(250);

    expect(autopilot.getSnapshot().state).toBe('ERROR');
    expect(adapter.submitCount).toBe(1);
  });

  it('enforces a non-zero session turn limit before a second continuation', () => {
    const { adapter, autopilot } = harness({ sessionTurnLimit: 1, postSubmitGuardMs: 1_000 });
    autopilot.enable();

    adapter.generating = true;
    adapter.emitActivity();
    adapter.generating = false;
    adapter.emitActivity();
    vi.advanceTimersByTime(100);
    expect(adapter.submitCount).toBe(1);

    adapter.generating = true;
    adapter.emitActivity();
    adapter.generating = false;
    adapter.emitActivity();
    vi.advanceTimersByTime(100);

    expect(autopilot.getSnapshot().state).toBe('PAUSED');
    expect(autopilot.getSnapshot().pauseReason).toBe('session turn limit reached');
    expect(adapter.submitCount).toBe(1);
  });
});
