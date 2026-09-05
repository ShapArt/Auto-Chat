import idleHtml from '../fixtures/chatgpt-idle.html?raw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAutopilot } from '../../src/main';
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

describe('standalone userscript bootstrap', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = idleHtml;
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
});
