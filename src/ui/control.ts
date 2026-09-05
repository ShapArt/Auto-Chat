import type { AutopilotState } from '../core/types';

export interface ControlSnapshot {
  state: AutopilotState;
  enabled: boolean;
  safeMode: boolean;
  recoveryState: string;
  sessionId: string;
  rolloverIndex: number;
  successfulTurns: number;
  generationEpoch: number;
}

export interface ControlCallbacks {
  onToggle(): void;
  onPause(): void;
  onStop(): void;
  onSafeMode(): void;
  onResetRecovery(): void;
  onOpenSettings(): void;
}

export interface AutopilotControlOptions {
  document?: Document;
  callbacks: ControlCallbacks;
  hotkey?: string;
}

const ROOT_ID = 'chatgpt-autopilot-control';
const DEFAULT_HOTKEY = 'Alt+Shift+A';

function stateLabel(snapshot: ControlSnapshot): string {
  if (snapshot.safeMode) return 'AUTO · safe mode';
  if (snapshot.recoveryState === 'SAFETY_CHECK_WAIT') return 'AUTO · safety check';

  switch (snapshot.state) {
    case 'DISABLED':
      return 'AUTO · off';
    case 'ARMED':
      return 'AUTO · armed';
    case 'GENERATING':
      return 'AUTO · generating';
    case 'SETTLING':
      return 'AUTO · settling';
    case 'READY':
      return 'AUTO · ready';
    case 'SUBMITTING':
      return 'AUTO · submitting';
    case 'COOLDOWN':
      return 'AUTO · cooldown';
    case 'PAUSED':
      return 'AUTO · paused';
    case 'ERROR':
      return 'AUTO · error';
  }
}

function technicalTooltip(snapshot: ControlSnapshot): string {
  return [
    `session ${snapshot.sessionId}`,
    `state ${snapshot.state}`,
    `recovery ${snapshot.recoveryState}`,
    `part ${snapshot.rolloverIndex}`,
    `turns ${snapshot.successfulTurns}`,
    `epoch ${snapshot.generationEpoch}`,
    snapshot.safeMode ? 'safe mode enabled' : 'safe mode disabled',
  ].join(' · ');
}

interface ParsedHotkey {
  key: string;
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

function parseHotkey(value: string): ParsedHotkey | null {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let key = '';
  let alt = false;
  let shift = false;
  let ctrl = false;
  let meta = false;

  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized === 'alt') alt = true;
    else if (normalized === 'shift') shift = true;
    else if (normalized === 'ctrl' || normalized === 'control') ctrl = true;
    else if (normalized === 'meta' || normalized === 'cmd' || normalized === 'command') meta = true;
    else if (key.length === 0) key = part;
    else return null;
  }

  if (key.length === 0) return null;
  return { key: key.toLowerCase(), alt, shift, ctrl, meta };
}

function button(
  documentRef: Document,
  action: string,
  label: string,
  title: string,
): HTMLButtonElement {
  const element = documentRef.createElement('button');
  element.type = 'button';
  element.dataset.action = action;
  element.textContent = label;
  element.title = title;
  return element;
}

export class AutopilotControl {
  private readonly doc: Document;
  private readonly callbacks: ControlCallbacks;
  private readonly hotkey: ParsedHotkey | null;
  private root: HTMLDivElement | null = null;
  private statusButton: HTMLButtonElement | null = null;
  private resetRecoveryButton: HTMLButtonElement | null = null;
  private mounted = false;

  constructor(options: AutopilotControlOptions) {
    this.doc = options.document ?? globalThis.document;
    this.callbacks = options.callbacks;
    this.hotkey = parseHotkey(options.hotkey ?? DEFAULT_HOTKEY);
  }

  mount(): void {
    if (this.mounted) return;

    const existing = this.doc.getElementById(ROOT_ID);
    if (existing) return;

    const root = this.doc.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'ChatGPT Autopilot controls');
    root.setAttribute('data-chatgpt-autopilot-owned', 'true');

    const style = this.doc.createElement('style');
    style.textContent = `
#${ROOT_ID} {
  position: fixed;
  right: 18px;
  bottom: 92px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  max-width: min(92vw, 560px);
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 12px;
  background: rgba(24, 24, 27, 0.94);
  color: #f4f4f5;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.24);
  font: 600 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  backdrop-filter: blur(10px);
}
#${ROOT_ID} button {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 7px 9px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
#${ROOT_ID} button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
#${ROOT_ID} button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
#${ROOT_ID} button:disabled { opacity: 0.42; cursor: not-allowed; }
#${ROOT_ID} [data-action="toggle"] { min-width: 116px; text-align: left; }
#${ROOT_ID} [data-action="stop"] { border-color: rgba(255, 120, 120, 0.42); }
@media (max-width: 720px) {
  #${ROOT_ID} { right: 10px; bottom: 82px; gap: 4px; padding: 5px; }
  #${ROOT_ID} button { padding: 6px 7px; }
  #${ROOT_ID} [data-action="pause"],
  #${ROOT_ID} [data-action="reset-recovery"],
  #${ROOT_ID} [data-action="settings"] { display: none; }
}
`;

    const statusButton = button(this.doc, 'toggle', 'AUTO · off', 'Toggle Autopilot');
    statusButton.dataset.role = 'status';
    const pauseButton = button(this.doc, 'pause', 'Pause', 'Pause automation');
    const stopButton = button(this.doc, 'stop', 'Stop', 'Emergency stop and disable automation');
    const safeButton = button(this.doc, 'safe-mode', 'Safe', 'Enter Safe Mode');
    const resetButton = button(
      this.doc,
      'reset-recovery',
      'Reset',
      'Reset recovery circuit breaker',
    );
    const settingsButton = button(this.doc, 'settings', 'Settings', 'Open Autopilot settings');

    statusButton.addEventListener('click', this.callbacks.onToggle);
    pauseButton.addEventListener('click', this.callbacks.onPause);
    stopButton.addEventListener('click', this.callbacks.onStop);
    safeButton.addEventListener('click', this.callbacks.onSafeMode);
    resetButton.addEventListener('click', this.callbacks.onResetRecovery);
    settingsButton.addEventListener('click', this.callbacks.onOpenSettings);

    root.append(
      style,
      statusButton,
      pauseButton,
      stopButton,
      safeButton,
      resetButton,
      settingsButton,
    );
    this.doc.body.append(root);

    this.root = root;
    this.statusButton = statusButton;
    this.resetRecoveryButton = resetButton;
    this.doc.addEventListener('keydown', this.handleKeydown);
    this.mounted = true;
  }

  unmount(): void {
    if (!this.mounted) return;
    this.doc.removeEventListener('keydown', this.handleKeydown);
    this.root?.remove();
    this.root = null;
    this.statusButton = null;
    this.resetRecoveryButton = null;
    this.mounted = false;
  }

  render(snapshot: ControlSnapshot): void {
    if (!this.root || !this.statusButton || !this.resetRecoveryButton) return;

    this.statusButton.textContent = stateLabel(snapshot);
    this.statusButton.setAttribute(
      'aria-pressed',
      snapshot.enabled && !snapshot.safeMode ? 'true' : 'false',
    );
    this.resetRecoveryButton.disabled = snapshot.safeMode;
    this.root.dataset.state = snapshot.state.toLowerCase();
    this.root.dataset.safeMode = snapshot.safeMode ? 'true' : 'false';
    this.root.title = technicalTooltip(snapshot);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (!this.hotkey || event.isComposing || event.repeat) return;

    const matches =
      event.key.toLowerCase() === this.hotkey.key &&
      event.altKey === this.hotkey.alt &&
      event.shiftKey === this.hotkey.shift &&
      event.ctrlKey === this.hotkey.ctrl &&
      event.metaKey === this.hotkey.meta;

    if (!matches) return;
    event.preventDefault();
    this.callbacks.onToggle();
  };
}
