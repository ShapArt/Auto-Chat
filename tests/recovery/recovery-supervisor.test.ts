import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECOVERY_SETTINGS,
  RecoverySupervisor,
  type RecoveryActions,
} from '../../src/recovery/recovery-supervisor';

function harness() {
  const actions: RecoveryActions = {
    stopGeneration: vi.fn(() => true),
    regenerate: vi.fn(() => true),
    reload: vi.fn(),
    rollover: vi.fn(() => true),
    pause: vi.fn(),
  };
  const supervisor = new RecoverySupervisor(
    {
      ...DEFAULT_RECOVERY_SETTINGS,
      softStallTimeoutMs: 1_000,
      hardStallTimeoutMs: 2_000,
      onlineSettleMs: 500,
      maxRegeneratesPerTurn: 1,
      maxReloadsPerWindow: 2,
      reloadWindowMs: 10_000,
      maxRecoveryFailures: 3,
    },
    actions,
  );
  return { supervisor, actions };
}

describe('RecoverySupervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not treat a long generation with relevant activity as a stall', () => {
    const { supervisor, actions } = harness();
    supervisor.onGenerationStarted(0);
    supervisor.onRelevantActivity(800);
    supervisor.tick(1_500);
    supervisor.onRelevantActivity(1_700);
    supervisor.tick(2_600);

    expect(supervisor.getSnapshot().state).toBe('GENERATING');
    expect(actions.stopGeneration).not.toHaveBeenCalled();
  });

  it('never interrupts an active safety check', () => {
    const { supervisor, actions } = harness();
    supervisor.onGenerationStarted(0);
    supervisor.observeError('SAFETY_CHECK', 500);
    supervisor.tick(50_000);

    expect(supervisor.getSnapshot().state).toBe('SAFETY_CHECK_WAIT');
    expect(actions.stopGeneration).not.toHaveBeenCalled();
    expect(actions.regenerate).not.toHaveBeenCalled();
    expect(actions.reload).not.toHaveBeenCalled();
  });

  it('enters SUSPECT_STALL at the soft timeout and cancels it when activity resumes', () => {
    const { supervisor } = harness();
    supervisor.onGenerationStarted(0);

    supervisor.tick(1_001);
    expect(supervisor.getSnapshot().state).toBe('SUSPECT_STALL');

    supervisor.onRelevantActivity(1_100);
    expect(supervisor.getSnapshot().state).toBe('GENERATING');
  });

  it('confirms a hard stall and issues Stop at most once', () => {
    const { supervisor, actions } = harness();
    supervisor.onGenerationStarted(0);

    supervisor.tick(1_001);
    supervisor.tick(2_001);
    supervisor.tick(2_500);

    expect(supervisor.getSnapshot().state).toBe('STOPPING');
    expect(actions.stopGeneration).toHaveBeenCalledTimes(1);
  });

  it('allows at most one regenerate attempt for a failed turn', () => {
    const { supervisor, actions } = harness();
    supervisor.observeError('GENERATION_FAILED', 100);

    expect(supervisor.requestRegenerate(200)).toBe(true);
    expect(supervisor.requestRegenerate(300)).toBe(false);
    expect(actions.regenerate).toHaveBeenCalledTimes(1);
  });

  it.each(['RATE_LIMIT', 'USAGE_LIMIT', 'LOGIN_REQUIRED', 'VERIFICATION_REQUIRED'] as const)(
    'treats %s as terminal for automation',
    (kind) => {
      const { supervisor, actions } = harness();
      supervisor.onGenerationStarted(0);
      supervisor.observeError(kind, 100);
      supervisor.tick(10_000);

      expect(supervisor.getSnapshot().state).toBe('PAUSED');
      expect(actions.pause).toHaveBeenCalledTimes(1);
      expect(actions.stopGeneration).not.toHaveBeenCalled();
      expect(actions.regenerate).not.toHaveBeenCalled();
      expect(actions.reload).not.toHaveBeenCalled();
    },
  );

  it('pauses while offline and does not instantly recover when connectivity returns', () => {
    const { supervisor, actions } = harness();
    supervisor.onGenerationStarted(0);

    supervisor.setOnline(false, 200);
    expect(supervisor.getSnapshot().state).toBe('PAUSED_NETWORK');
    expect(actions.pause).toHaveBeenCalledWith('network offline');

    supervisor.setOnline(true, 1_000);
    expect(supervisor.getSnapshot().state).toBe('RECOVERY_WAIT');
    supervisor.tick(1_499);
    expect(actions.stopGeneration).not.toHaveBeenCalled();
    expect(actions.regenerate).not.toHaveBeenCalled();

    supervisor.tick(1_500);
    expect(supervisor.getSnapshot().state).toBe('GENERATING');
  });

  it('trips the reload circuit breaker instead of creating a reload loop', () => {
    const { supervisor, actions } = harness();

    expect(supervisor.requestReload(0)).toBe(true);
    expect(supervisor.requestReload(100)).toBe(true);
    expect(supervisor.requestReload(200)).toBe(false);

    expect(actions.reload).toHaveBeenCalledTimes(2);
    expect(supervisor.getSnapshot().state).toBe('FATAL');
    expect(actions.pause).toHaveBeenCalledWith('recovery circuit breaker tripped');
  });

  it('trips the failure circuit breaker after repeated recoverable errors', () => {
    const { supervisor, actions } = harness();

    supervisor.observeError('GENERATION_FAILED', 100);
    supervisor.observeError('NETWORK_ERROR', 200);
    supervisor.observeError('GENERATION_FAILED', 300);

    expect(supervisor.getSnapshot().state).toBe('FATAL');
    expect(actions.pause).toHaveBeenCalledWith('recovery circuit breaker tripped');
  });

  it('a successful completion resets per-turn recovery counters', () => {
    const { supervisor } = harness();
    supervisor.observeError('GENERATION_FAILED', 100);
    expect(supervisor.requestRegenerate(200)).toBe(true);
    expect(supervisor.getSnapshot().regeneratesThisTurn).toBe(1);
    expect(supervisor.getSnapshot().recoveryFailures).toBe(1);

    supervisor.onGenerationFinished(1_000);

    expect(supervisor.getSnapshot().state).toBe('NORMAL');
    expect(supervisor.getSnapshot().regeneratesThisTurn).toBe(0);
    expect(supervisor.getSnapshot().recoveryFailures).toBe(0);
  });
});
