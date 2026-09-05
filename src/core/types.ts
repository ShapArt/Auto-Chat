export type AutopilotState =
  | 'DISABLED'
  | 'ARMED'
  | 'GENERATING'
  | 'SETTLING'
  | 'READY'
  | 'SUBMITTING'
  | 'COOLDOWN'
  | 'PAUSED'
  | 'ERROR';

export type AutopilotEvent =
  | { type: 'ENABLE' }
  | { type: 'DISABLE' }
  | { type: 'GENERATION_STARTED' }
  | { type: 'GENERATION_STOPPED' }
  | { type: 'SETTLED' }
  | { type: 'SUBMIT_STARTED' }
  | { type: 'SUBMIT_SUCCEEDED' }
  | { type: 'NEXT_GENERATION_STARTED' }
  | { type: 'MANUAL_INPUT' }
  | { type: 'CONVERSATION_CHANGED' }
  | { type: 'PAUSE' }
  | { type: 'FAIL' };
