export interface LogSink {
  debug(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
}

export class Logger {
  constructor(
    private enabled = false,
    private readonly sink: LogSink = console,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  debug(message: string, details?: Record<string, unknown>): void {
    if (!this.enabled) return;
    if (details) this.sink.debug(`[ChatGPT Autopilot] ${message}`, details);
    else this.sink.debug(`[ChatGPT Autopilot] ${message}`);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    if (!this.enabled) return;
    if (details) this.sink.warn(`[ChatGPT Autopilot] ${message}`, details);
    else this.sink.warn(`[ChatGPT Autopilot] ${message}`);
  }

  error(message: string, details?: Record<string, unknown>): void {
    if (!this.enabled) return;
    if (details) this.sink.error(`[ChatGPT Autopilot] ${message}`, details);
    else this.sink.error(`[ChatGPT Autopilot] ${message}`);
  }
}
