import type { AutopilotEvent, AutopilotState } from './types';

export function transition(state: AutopilotState, event: AutopilotEvent): AutopilotState {
  if (event.type === 'DISABLE') return 'DISABLED';

  if (state === 'DISABLED') {
    return event.type === 'ENABLE' ? 'ARMED' : 'DISABLED';
  }

  if (event.type === 'MANUAL_INPUT' || event.type === 'CONVERSATION_CHANGED') {
    return 'PAUSED';
  }

  if (event.type === 'FAIL') return 'ERROR';

  switch (event.type) {
    case 'GENERATION_STARTED':
      return state === 'ARMED' || state === 'COOLDOWN' ? 'GENERATING' : state;
    case 'GENERATION_STOPPED':
      return state === 'GENERATING' ? 'SETTLING' : state;
    case 'SETTLED':
      return state === 'SETTLING' ? 'READY' : state;
    case 'SUBMIT_STARTED':
      return state === 'READY' ? 'SUBMITTING' : state;
    case 'SUBMIT_SUCCEEDED':
      return state === 'SUBMITTING' ? 'COOLDOWN' : state;
    case 'NEXT_GENERATION_STARTED':
      return state === 'COOLDOWN' ? 'GENERATING' : state;
    case 'ENABLE':
    case 'DISABLE':
    case 'MANUAL_INPUT':
    case 'CONVERSATION_CHANGED':
    case 'FAIL':
      return state;
  }
}
