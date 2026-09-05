import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autopilot } from '../../src/core/autopilot';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

class FakeAdapter {
  generating = false;
  composerEmpty = true;
  inserted: string[] = [];
  private callback: (() => void) | null = null;

  isGenerating(): boolean {
    return this.generating;
  }

  isComposerEmpty(): boolean {
    return this.composerEmpty;
  }

  composerMatchesText(text: string): boolean {
    return !this.composerEmpty && this.inserted.at(-1) === text;
  }

  canSubmit(): boolean {
    return !this.generating;
  }

  insertComposerText(text: string): boolean {
    if (!this.composerEmpty) return false;
    this.inserted.push(text);
    this.composerEmpty = false;
    return true;
  }

  submitPrompt(): boolean {
    if (this.generating || this.composerEmpty) return false;
    this.composerEmpty = true;
    return true;
  }

  observeRelevantActivity(callback: () => void): () => void {
    this.callback = callback;
    return () => {
      this.callback = null;
    };
  }

  emit(): void {
    this.callback?.();
  }
}

describe('Autopilot checkpoint integration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the checkpoint continuation on exact successful-turn boundaries', () => {
    const adapter = new FakeAdapter();
    const settings = {
      ...DEFAULT_SETTINGS,
      continuationPrompt: 'CONTINUE',
      checkpointEvery: 1,
      completionDebounceMs: 100,
      postSubmitGuardMs: 1_000,
      watchdogMs: 5_000,
    };
    const autopilot = new Autopilot(adapter, settings, {
      getConversationKey: () => '/g/g-p-synthetic/c/thread-a',
      sessionIdentity: { sessionId: 'auto-20260905-abc123', rolloverIndex: 0 },
    });

    autopilot.start();
    autopilot.enable();

    adapter.generating = true;
    adapter.emit();
    adapter.generating = false;
    adapter.emit();
    vi.advanceTimersByTime(100);

    expect(adapter.inserted[0]).toBe('CONTINUE');

    adapter.generating = true;
    adapter.emit();
    adapter.generating = false;
    adapter.emit();
    vi.advanceTimersByTime(100);

    expect(adapter.inserted[1]).toContain('AUTOPILOT_CHECKPOINT_V1');
    expect(adapter.inserted[1]).toContain('auto-20260905-abc123');
  });
});