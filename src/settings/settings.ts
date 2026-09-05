export const SETTINGS_KEY = 'chatgpt-autopilot.settings.v1';

export const DEFAULT_CONTINUATION_PROMPT =
  'Продолжай выполнение текущей задачи с того места, где остановился. Не повторяй уже выполненное. Соблюдай исходные требования, ранее согласованную архитектуру и план. Продолжай выполнять реальные следующие шаги. Используй релевантные доступные engineering skills/workflows там, где они действительно требуются. Не описывай скрытую цепочку рассуждений — просто продолжай работу и показывай результаты.';

export interface AutopilotSettings {
  continuationPrompt: string;
  completionDebounceMs: number;
  postSubmitGuardMs: number;
  watchdogMs: number;
  softStallTimeoutMs: number;
  hardStallTimeoutMs: number;
  checkpointEvery: number;
  sessionTurnLimit: number;
  hotkey: string;
  debug: boolean;
}

export const DEFAULT_SETTINGS: Readonly<AutopilotSettings> = Object.freeze({
  continuationPrompt: DEFAULT_CONTINUATION_PROMPT,
  completionDebounceMs: 1_500,
  postSubmitGuardMs: 2_000,
  watchdogMs: 5_000,
  softStallTimeoutMs: 180_000,
  hardStallTimeoutMs: 600_000,
  checkpointEvery: 10,
  sessionTurnLimit: 0,
  hotkey: 'Alt+Shift+A',
  debug: false,
});

export interface SettingsStorage {
  getValue<T>(key: string, fallback: T): T | Promise<T>;
  setValue<T>(key: string, value: T): void | Promise<void>;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return Math.trunc(finiteNumber(value, fallback, min, max));
}

function nonEmptyString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return fallback;
  return value;
}

export function normalizeSettings(value: unknown): AutopilotSettings {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

  const softStallTimeoutMs = finiteNumber(
    source.softStallTimeoutMs,
    DEFAULT_SETTINGS.softStallTimeoutMs,
    30_000,
    1_800_000,
  );
  const hardStallTimeoutMs = Math.max(
    softStallTimeoutMs,
    finiteNumber(
      source.hardStallTimeoutMs,
      DEFAULT_SETTINGS.hardStallTimeoutMs,
      60_000,
      3_600_000,
    ),
  );

  return {
    continuationPrompt: nonEmptyString(
      source.continuationPrompt,
      DEFAULT_SETTINGS.continuationPrompt,
      20_000,
    ),
    completionDebounceMs: finiteNumber(
      source.completionDebounceMs,
      DEFAULT_SETTINGS.completionDebounceMs,
      250,
      10_000,
    ),
    postSubmitGuardMs: finiteNumber(
      source.postSubmitGuardMs,
      DEFAULT_SETTINGS.postSubmitGuardMs,
      500,
      15_000,
    ),
    watchdogMs: finiteNumber(source.watchdogMs, DEFAULT_SETTINGS.watchdogMs, 1_000, 30_000),
    softStallTimeoutMs,
    hardStallTimeoutMs,
    checkpointEvery: integer(source.checkpointEvery, DEFAULT_SETTINGS.checkpointEvery, 0, 1_000),
    sessionTurnLimit: integer(
      source.sessionTurnLimit,
      DEFAULT_SETTINGS.sessionTurnLimit,
      0,
      10_000,
    ),
    hotkey: nonEmptyString(source.hotkey, DEFAULT_SETTINGS.hotkey, 100),
    debug: typeof source.debug === 'boolean' ? source.debug : DEFAULT_SETTINGS.debug,
  };
}

export class SettingsStore {
  constructor(private readonly storage: SettingsStorage) {}

  async load(): Promise<AutopilotSettings> {
    const stored = await Promise.resolve(this.storage.getValue<unknown>(SETTINGS_KEY, {}));
    return normalizeSettings(stored);
  }

  async save(settings: AutopilotSettings): Promise<void> {
    await Promise.resolve(this.storage.setValue(SETTINGS_KEY, normalizeSettings(settings)));
  }

  async reset(): Promise<void> {
    await Promise.resolve(this.storage.setValue(SETTINGS_KEY, { ...DEFAULT_SETTINGS }));
  }
}
