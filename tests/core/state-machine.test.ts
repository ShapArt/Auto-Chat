import { describe, expect, it } from 'vitest';
import { transition } from '../../src/core/state-machine';

describe('transition', () => {
  it('arms when enabled and never treats idle as completion', () => {
    expect(transition('DISABLED', { type: 'ENABLE' })).toBe('ARMED');
    expect(transition('ARMED', { type: 'SETTLED' })).toBe('ARMED');
  });

  it('requires a real generation cycle before READY', () => {
    let state = transition('DISABLED', { type: 'ENABLE' });
    state = transition(state, { type: 'GENERATION_STARTED' });
    expect(state).toBe('GENERATING');
    state = transition(state, { type: 'GENERATION_STOPPED' });
    expect(state).toBe('SETTLING');
    state = transition(state, { type: 'SETTLED' });
    expect(state).toBe('READY');
  });

  it('moves through submit and cooldown only from the intended states', () => {
    expect(transition('READY', { type: 'SUBMIT_STARTED' })).toBe('SUBMITTING');
    expect(transition('SUBMITTING', { type: 'SUBMIT_SUCCEEDED' })).toBe('COOLDOWN');
    expect(transition('COOLDOWN', { type: 'NEXT_GENERATION_STARTED' })).toBe('GENERATING');
  });

  it('manual input and conversation changes pause from active states', () => {
    expect(transition('GENERATING', { type: 'MANUAL_INPUT' })).toBe('PAUSED');
    expect(transition('COOLDOWN', { type: 'CONVERSATION_CHANGED' })).toBe('PAUSED');
    expect(transition('ARMED', { type: 'PAUSE' })).toBe('PAUSED');
  });

  it('fails closed into ERROR', () => {
    expect(transition('GENERATING', { type: 'FAIL' })).toBe('ERROR');
  });

  it('disable wins from every non-disabled state', () => {
    for (const state of [
      'ARMED',
      'GENERATING',
      'SETTLING',
      'READY',
      'SUBMITTING',
      'COOLDOWN',
      'PAUSED',
      'ERROR',
    ] as const) {
      expect(transition(state, { type: 'DISABLE' })).toBe('DISABLED');
    }
  });
});
