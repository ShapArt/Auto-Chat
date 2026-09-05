import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutopilotControl, type ControlSnapshot } from '../../src/ui/control';

function snapshot(overrides: Partial<ControlSnapshot> = {}): ControlSnapshot {
  return {
    state: 'DISABLED',
    enabled: false,
    safeMode: false,
    recoveryState: 'NORMAL',
    sessionId: 'auto-20260905-abc123',
    rolloverIndex: 2,
    successfulTurns: 7,
    generationEpoch: 8,
    ...overrides,
  };
}

function harness() {
  const callbacks = {
    onToggle: vi.fn(),
    onPause: vi.fn(),
    onStop: vi.fn(),
    onSafeMode: vi.fn(),
    onResetRecovery: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  const control = new AutopilotControl({ document, callbacks, hotkey: 'Alt+Shift+A' });
  return { control, callbacks };
}

describe('AutopilotControl', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts exactly once and renders compact technical states', () => {
    const { control } = harness();
    control.mount();
    control.mount();

    expect(document.querySelectorAll('#chatgpt-autopilot-control')).toHaveLength(1);

    const status = () => document.querySelector('[data-role="status"]')?.textContent;
    control.render(snapshot());
    expect(status()).toBe('AUTO · off');
    control.render(snapshot({ state: 'ARMED', enabled: true }));
    expect(status()).toBe('AUTO · armed');
    control.render(snapshot({ state: 'GENERATING', enabled: true }));
    expect(status()).toBe('AUTO · generating');
    control.render(snapshot({ state: 'PAUSED', enabled: true }));
    expect(status()).toBe('AUTO · paused');
    control.render(snapshot({ state: 'GENERATING', enabled: true, recoveryState: 'SAFETY_CHECK_WAIT' }));
    expect(status()).toBe('AUTO · safety check');
  });

  it('toggles from the primary control and via Alt+Shift+A unless composing', () => {
    const { control, callbacks } = harness();
    control.mount();

    (document.querySelector('[data-action="toggle"]') as HTMLButtonElement).click();
    expect(callbacks.onToggle).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', altKey: true, shiftKey: true }));
    expect(callbacks.onToggle).toHaveBeenCalledTimes(2);

    const composing = new KeyboardEvent('keydown', { key: 'A', altKey: true, shiftKey: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    document.dispatchEvent(composing);
    expect(callbacks.onToggle).toHaveBeenCalledTimes(2);
  });

  it('keeps emergency stop available in every rendered state', () => {
    const { control, callbacks } = harness();
    control.mount();

    for (const state of ['DISABLED', 'ARMED', 'GENERATING', 'SETTLING', 'READY', 'SUBMITTING', 'COOLDOWN', 'PAUSED', 'ERROR'] as const) {
      control.render(snapshot({ state, enabled: state !== 'DISABLED' }));
      (document.querySelector('[data-action="stop"]') as HTMLButtonElement).click();
    }

    expect(callbacks.onStop).toHaveBeenCalledTimes(9);
  });

  it('enters Safe Mode without exposing recovery mutation controls', () => {
    const { control, callbacks } = harness();
    control.mount();

    (document.querySelector('[data-action="safe-mode"]') as HTMLButtonElement).click();
    expect(callbacks.onSafeMode).toHaveBeenCalledTimes(1);

    control.render(snapshot({ safeMode: true, enabled: false }));
    expect(document.querySelector('[data-role="status"]')?.textContent).toBe('AUTO · safe mode');
    expect((document.querySelector('[data-action="reset-recovery"]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-action="submit"]')).toBeNull();
    expect(document.querySelector('[data-action="regenerate"]')).toBeNull();
    expect(document.querySelector('[data-action="reload"]')).toBeNull();
    expect(document.querySelector('[data-action="rollover"]')).toBeNull();
  });

  it('shows only technical session/state/counter data in the tooltip', () => {
    const { control } = harness();
    control.mount();
    control.render(snapshot({ state: 'GENERATING', enabled: true }));

    const root = document.querySelector('#chatgpt-autopilot-control') as HTMLElement;
    expect(root.title).toContain('auto-20260905-abc123');
    expect(root.title).toContain('GENERATING');
    expect(root.title).toContain('part 2');
    expect(root.title).toContain('turns 7');
    expect(root.title).toContain('epoch 8');
    expect(root.title.toLowerCase()).not.toContain('prompt');
    expect(root.title.toLowerCase()).not.toContain('output');
    expect(root.title.toLowerCase()).not.toContain('conversation');
  });

  it('unmounts cleanly and removes the hotkey listener', () => {
    const { control, callbacks } = harness();
    control.mount();
    control.unmount();

    expect(document.querySelector('#chatgpt-autopilot-control')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', altKey: true, shiftKey: true }));
    expect(callbacks.onToggle).not.toHaveBeenCalled();
  });
});
