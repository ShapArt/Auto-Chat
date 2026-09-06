import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAutopilot } from '../../src/main';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../src/settings/settings';
import idleHtml from '../fixtures/chatgpt-idle.html?raw';

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  getValue<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  setValue<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
}

function installIdleHtml(): void {
  document.documentElement.innerHTML = idleHtml;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('runtime hardening', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installIdleHtml();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-arms only after the online settle window when automation was paused by offline', async () => {
    const storage = new MemoryStorage();
    storage.values.set(SETTINGS_KEY, {
      ...DEFAULT_SETTINGS,
      watchdogMs: 100,
    });
    let clock = 0;

    const runtime = await bootstrapAutopilot({
      document,
      storage,
      registerMenuCommand: vi.fn(),
      getPath: () => '/c/network-thread',
      reload: vi.fn(),
      now: () => clock,
    });

    (document.querySelector('[data-action="toggle"]') as HTMLButtonElement).click();
    expect(runtime.autopilot.getSnapshot().state).toBe('ARMED');

    window.dispatchEvent(new Event('offline'));
    expect(runtime.autopilot.getSnapshot().state).toBe('PAUSED');
    expect(runtime.autopilot.getSnapshot().pauseReason).toBe('network offline');
    expect(runtime.recovery.getSnapshot().state).toBe('PAUSED_NETWORK');

    clock = 1_000;
    window.dispatchEvent(new Event('online'));
    expect(runtime.recovery.getSnapshot().state).toBe('RECOVERY_WAIT');

    clock = 2_499;
    await vi.advanceTimersByTimeAsync(1_499);
    expect(runtime.autopilot.getSnapshot().state).toBe('PAUSED');

    clock = 2_500;
    await vi.advanceTimersByTimeAsync(1);

    expect(runtime.recovery.getSnapshot().state).toBe('NORMAL');
    expect(runtime.autopilot.getSnapshot().enabled).toBe(true);
    expect(runtime.autopilot.getSnapshot().state).toBe('ARMED');
    expect(runtime.autopilot.getSnapshot().pauseReason).toBeNull();

    runtime.dispose();
  });

  it('never submits a rollover resume prompt after the user edits the pending composer', async () => {
    const storage = new MemoryStorage();
    storage.values.set(SETTINGS_KEY, {
      ...DEFAULT_SETTINGS,
      watchdogMs: 10_000,
    });

    let currentPath = '/g/g-p-synthetic/c/thread-a';
    const projectHome = document.createElement('a');
    projectHome.href = '/g/g-p-synthetic/project';
    projectHome.addEventListener('click', (event) => {
      event.preventDefault();
      currentPath = '/g/g-p-synthetic/project';
    });
    document.body.append(projectHome);

    const limit = document.createElement('div');
    limit.setAttribute('role', 'alert');
    limit.textContent = "You've reached the maximum length for this conversation.";
    document.body.append(limit);

    const submit = document.querySelector('#composer-submit-button') as HTMLButtonElement;
    submit.disabled = true;
    const onSubmit = vi.fn();
    submit.addEventListener('click', onSubmit);

    const runtime = await bootstrapAutopilot({
      document,
      storage,
      registerMenuCommand: vi.fn(),
      getPath: () => currentPath,
      reload: vi.fn(),
      now: () => 10_000,
    });

    (document.querySelector('[data-action="toggle"]') as HTMLButtonElement).click();
    await flushMicrotasks();

    const composer = document.querySelector('#prompt-textarea') as HTMLElement;
    expect(composer.textContent).toContain('[AUTOPILOT_RESUME]');

    composer.textContent = 'Manual takeover';
    submit.disabled = false;
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(composer.textContent).toBe('Manual takeover');

    runtime.dispose();
  });
});
