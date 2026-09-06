import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore, type SettingsStorage } from '../../src/settings/settings';

class MemoryStorage implements SettingsStorage {
  values = new Map<string, unknown>();

  getValue<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  setValue<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
}

describe('SettingsStore', () => {
  it('loads privacy-safe defaults from empty storage', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const loaded = await store.load();

    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(loaded.debug).toBe(false);
    expect(loaded.sessionTurnLimit).toBe(0);
  });

  it('merges a persisted partial object with validated defaults', async () => {
    const storage = new MemoryStorage();
    storage.values.set('chatgpt-autopilot.settings.v1', {
      debug: true,
      completionDebounceMs: 2_500,
      sessionTurnLimit: 4,
    });
    const store = new SettingsStore(storage);

    const loaded = await store.load();

    expect(loaded.debug).toBe(true);
    expect(loaded.completionDebounceMs).toBe(2_500);
    expect(loaded.sessionTurnLimit).toBe(4);
    expect(loaded.continuationPrompt).toBe(DEFAULT_SETTINGS.continuationPrompt);
  });

  it('round-trips settings and can reset them', async () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage);
    const custom = { ...DEFAULT_SETTINGS, hotkey: 'Alt+Shift+Q', checkpointEvery: 5 };

    await store.save(custom);
    expect(await store.load()).toEqual(custom);

    await store.reset();
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });
});
