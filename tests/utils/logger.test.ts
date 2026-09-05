import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../../src/utils/logger';

describe('Logger', () => {
  it('is silent by default and logs only when explicitly enabled', () => {
    const sink = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const logger = new Logger(false, sink);

    logger.debug('state ARMED -> GENERATING', { epoch: 1 });
    expect(sink.debug).not.toHaveBeenCalled();

    logger.setEnabled(true);
    logger.debug('state ARMED -> GENERATING', { epoch: 1 });
    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(String(sink.debug.mock.calls[0]?.[0])).toContain('[ChatGPT Autopilot]');
  });
});
