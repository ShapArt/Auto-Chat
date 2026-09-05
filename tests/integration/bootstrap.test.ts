import errorHtml from '../fixtures/chatgpt-error.html?raw';
import idleHtml from '../fixtures/chatgpt-idle.html?raw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAutopilot } from '../../src/main';
import { createReloadResumeMarker, RELOAD_RESUME_KEY } from '../../src/recovery/reload-resume';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../src/settings/settings';

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  getValue<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  setValue<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
}

function installHtml(html: string): void {
  document.documentElement.innerHTML = html;
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('standalone userscript bootstrap', () => {
  beforeEach(() => {
    installHtml(idleHtml);
  });

  it('mounts controls on a synthetic ChatGPT page without submitting on idle or enable', async () => {
    const storage = new MemoryStorage();
    storage.values.set(SETTINGS_KEY, {
      ...DEFAULT_SETTINGS,
      completionDebounceMs: 250,
      watchdogMs: 5_000,
    });
    const registerMenuCommand = vi.fn();
    const submit = document.querySelector('#composer-submit-button') as HTMLButtonElement;
    const onSubmit = vi.fn();
    submit.addEventListener('click', onSubmit);

    const runtime = await bootstrapAutopilot({
      document,
      storage,
      registerMenuCommand,
      getPath: () => '/c/synthetic-thread',
      reload: vi.fn(),
    });

    expect(document.querySelector('#chatgpt-autopilot-control')).not.toBeNull();
    expect(runtime.autopilot.getSnapshot().state).toBe('DISABLED');
    expect(registerMenuCommand).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    (document.querySelector('[data-action="toggle"]') as HTMLButtonElement).click();
    expect(runtime.autopilot.getSnapshot().state).toBe('ARMED');
    expect(onSubmit).not.toHaveBeenCalled();

    runtime.dispose();
    expect(document.querySelector('#chatgpt-autopilot-control')).toBeNull();
  });

  it('never runs recovery while disabled but handles a visible generation error after explicit enable', async () => {
    installHtml(errorHtml);
    const storage = new MemoryStorage();
    storage.values.set(SETTINGS_KEY, {
      ...DEFAULT_SETTINGS,
      watchdogMs: 5_000,
    });
    const reload = vi.fn();

    const runtime = await bootstrapAutopilot({
      document,
      storage,
      registerMenuCommand: vi.fn(),
      getPath: () => '/c/synthetic-error-thread',
      reload,
    });

    const error = document.querySelector('[data-testid="conversation-turn-error"]') as HTMLElement;
    error.style.opacity = '0.99';
    await flushMutations();

    expect(runtime.autopilot.getSnapshot().state).toBe('DISABLED');
    expect(reload).not.toHaveBeenCalled();

    (document.querySelector('[data-action="toggle"]') as HTMLButtonElement).click();
    expect(runtime.autopilot.getSnapshot().state).toBe('ARMED');

    error.style.opacity = '0.98';
    await flushMutations();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(runtime.recovery.getSnapshot().state).toBe('RELOADING');

    runtime.dispose();
  });

  it('restores a fresh same-path reload marker without immediately submitting', async () => {
    const storage = new MemoryStorage();
    storage.values.set(SETTINGS_KEY, {
      ...DEFAULT_SETTINGS,
      watchdogMs: 5_000,
    });
    storage.values.set(
      RELOAD_RESUME_KEY,
      createReloadResumeMarker({
        path: '/g/g-p-synthetic/c/thread-a',
        requestedAt: 10_000,
        sessionIdentity: { sessionId: 'auto-20260905-resume01', rolloverIndex: 3 },
        reloadTimestamps: [9_000, 10_000],
      }),
    );
    const submit = document.querySelector('#composer-submit-button') as HTMLButtonElement;
    const onSubmit = vi.fn();
    submit.addEventListener('click', onSubmit);

    const runtime = await bootstrapAutopilot({
      document,
      storage,
      registerMenuCommand: vi.fn(),
      getPath: () => '/g/g-p-synthetic/c/thread-a',
      reload: vi.fn(),
      now: () => 10_500,
    });

    const snapshot = runtime.autopilot.getSnapshot();
    expect(snapshot.state).toBe('ARMED');
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.sessionId).toBe('auto-20260905-resume01');
    expect(snapshot.rolloverIndex).toBe(3);
    expect(runtime.recovery.getReloadHistory(10_500)).toEqual([9_000, 10_000]);
    expect(storage.values.get(RELOAD_RESUME_KEY)).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    runtime.dispose();
  });

  it('consumes an invalid reload marker and stays disabled', async () => {
    const storage = new MemoryStorage();
    storage.values.set(RELOAD_RESUME_KEY, {
      version: 1,
      path: '/c/other-thread',
      requestedAt: 10_000,
      sessionId: 'auto-20260905-invalid',
      rolloverIndex: 0,
      reloadTimestamps: [10_000],
    });

    const runtime = await bootstrapAutopilot({
      document,
      storage,
      registerMenuCommand: vi.fn(),
      getPath: () => '/c/current-thread',
      reload: vi.fn(),
      now: () => 10_500,
    });

    expect(runtime.autopilot.getSnapshot().state).toBe('DISABLED');
    expect(runtime.autopilot.getSnapshot().enabled).toBe(false);
    expect(storage.values.get(RELOAD_RESUME_KEY)).toBeNull();

    runtime.dispose();
  });
});
