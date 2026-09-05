import { ChatGptDomAdapter } from './chatgpt/dom-adapter';
import { Autopilot } from './core/autopilot';
import type { AutopilotState } from './core/types';
import {
  buildResumePrompt,
  createSessionIdentity,
  ProjectNavigator,
  type SessionIdentity,
} from './navigation/project-navigator';
import { classifyUiError } from './recovery/error-classifier';
import {
  DEFAULT_RECOVERY_SETTINGS,
  RecoverySupervisor,
  type RecoverySnapshot,
} from './recovery/recovery-supervisor';
import { SettingsStore, type AutopilotSettings, type SettingsStorage } from './settings/settings';
import { AutopilotControl } from './ui/control';

export interface BootstrapOptions {
  document: Document;
  storage: SettingsStorage;
  registerMenuCommand(name: string, callback: () => void): unknown;
  getPath?: () => string;
  reload?: () => void;
  now?: () => number;
}

export interface AutopilotRuntime {
  autopilot: Autopilot;
  recovery: RecoverySupervisor;
  navigator: ProjectNavigator;
  control: AutopilotControl;
  dispose(): void;
}

function visible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden');
}

function clickFirstVisible(doc: Document, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    const candidate = doc.querySelector<HTMLElement>(selector);
    if (!candidate || !visible(candidate)) continue;
    candidate.click();
    return true;
  }
  return false;
}

function openSettingsDialog(
  doc: Document,
  settings: AutopilotSettings,
  store: SettingsStore,
): void {
  const existing = doc.getElementById('chatgpt-autopilot-settings') as HTMLDialogElement | null;
  if (existing) {
    if (typeof existing.showModal === 'function' && !existing.open) existing.showModal();
    else existing.open = true;
    return;
  }

  const dialog = doc.createElement('dialog');
  dialog.id = 'chatgpt-autopilot-settings';
  dialog.setAttribute('data-chatgpt-autopilot-owned', 'true');
  dialog.style.cssText = [
    'position:fixed',
    'z-index:2147483001',
    'max-width:min(92vw,620px)',
    'width:560px',
    'border:1px solid rgba(127,127,127,.32)',
    'border-radius:14px',
    'padding:18px',
    'background:#18181b',
    'color:#f4f4f5',
    'font:500 13px/1.45 ui-sans-serif,system-ui,sans-serif',
  ].join(';');

  const title = doc.createElement('h2');
  title.textContent = 'Autopilot settings';
  title.style.cssText = 'margin:0 0 14px;font-size:16px';

  const form = doc.createElement('form');
  form.method = 'dialog';
  form.style.cssText = 'display:grid;gap:12px';

  const promptLabel = doc.createElement('label');
  promptLabel.textContent = 'Continuation prompt';
  promptLabel.style.cssText = 'display:grid;gap:6px';
  const prompt = doc.createElement('textarea');
  prompt.name = 'continuationPrompt';
  prompt.value = settings.continuationPrompt;
  prompt.rows = 6;
  prompt.style.cssText = 'width:100%;box-sizing:border-box;border-radius:8px;padding:9px';
  promptLabel.append(prompt);

  const numberRow = doc.createElement('div');
  numberRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';

  const checkpointLabel = doc.createElement('label');
  checkpointLabel.textContent = 'Checkpoint every N turns (0 = off)';
  const checkpoint = doc.createElement('input');
  checkpoint.type = 'number';
  checkpoint.min = '0';
  checkpoint.max = '1000';
  checkpoint.value = String(settings.checkpointEvery);
  checkpoint.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;padding:8px';
  checkpointLabel.append(checkpoint);

  const turnLimitLabel = doc.createElement('label');
  turnLimitLabel.textContent = 'Session turn limit (0 = unlimited)';
  const turnLimit = doc.createElement('input');
  turnLimit.type = 'number';
  turnLimit.min = '0';
  turnLimit.max = '10000';
  turnLimit.value = String(settings.sessionTurnLimit);
  turnLimit.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;padding:8px';
  turnLimitLabel.append(turnLimit);
  numberRow.append(checkpointLabel, turnLimitLabel);

  const note = doc.createElement('p');
  note.textContent = `Hotkey: ${settings.hotkey}. Timing/recovery defaults stay conservative in v0.1.0.`;
  note.style.cssText = 'margin:0;color:#a1a1aa;font-size:12px';

  const actions = doc.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const save = doc.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  for (const item of [cancel, save]) {
    item.style.cssText =
      'border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 11px;background:#27272a;color:#f4f4f5';
  }
  actions.append(cancel, save);

  form.append(promptLabel, numberRow, note, actions);
  dialog.append(title, form);
  doc.body.append(dialog);

  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const nextPrompt = prompt.value.trim();
    if (nextPrompt.length > 0) settings.continuationPrompt = prompt.value;
    settings.checkpointEvery = Number.parseInt(checkpoint.value, 10) || 0;
    settings.sessionTurnLimit = Number.parseInt(turnLimit.value, 10) || 0;
    void store.save(settings);
    dialog.close();
  });

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.open = true;
}

async function submitResumeAfterRollover(
  adapter: ChatGptDomAdapter,
  identity: SessionIdentity,
  isSafeMode: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  const prompt = buildResumePrompt(identity);
  let inserted = false;

  while (Date.now() < deadline) {
    if (isSafeMode()) return false;

    if (!inserted && adapter.isComposerEmpty()) {
      inserted = adapter.insertComposerText(prompt);
    }

    if (inserted && adapter.canSubmit()) return adapter.submitPrompt();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

export async function bootstrapAutopilot(options: BootstrapOptions): Promise<AutopilotRuntime> {
  const doc = options.document;
  const getPath = options.getPath ?? (() => doc.defaultView?.location.pathname ?? '/');
  const reload = options.reload ?? (() => doc.defaultView?.location.reload());
  const now = options.now ?? (() => Date.now());
  const settingsStore = new SettingsStore(options.storage);
  const settings = await settingsStore.load();
  const sessionIdentity = createSessionIdentity();
  const adapter = new ChatGptDomAdapter(doc);
  const navigator = new ProjectNavigator(sessionIdentity, { document: doc, getPath });

  let safeMode = false;
  let previousAutopilotState: AutopilotState = 'DISABLED';

  const autopilot = new Autopilot(adapter, settings, {
    getConversationKey: getPath,
    sessionIdentity,
    onStateChange: (snapshot) => {
      const timestamp = now();
      if (snapshot.state === 'GENERATING' && previousAutopilotState !== 'GENERATING') {
        recovery.onGenerationStarted(timestamp);
      }
      if (snapshot.state === 'READY' && previousAutopilotState === 'SETTLING') {
        recovery.onGenerationFinished(timestamp);
      }
      previousAutopilotState = snapshot.state;
      render();
    },
  });

  const recovery = new RecoverySupervisor(
    {
      ...DEFAULT_RECOVERY_SETTINGS,
      softStallTimeoutMs: settings.softStallTimeoutMs,
      hardStallTimeoutMs: settings.hardStallTimeoutMs,
    },
    {
      stopGeneration: () => {
        if (safeMode) return false;
        const button = adapter.findStopButton();
        if (!button) return false;
        button.click();
        return true;
      },
      regenerate: () => {
        if (safeMode) return false;
        return clickFirstVisible(doc, [
          '[data-testid="regenerate-button"]',
          '[data-testid="retry-button"]',
        ]);
      },
      reload: () => {
        if (!safeMode) reload();
      },
      rollover: () => {
        if (safeMode) return false;
        const context = navigator.captureContext();
        if (!navigator.canRollover(context)) return false;

        autopilot.disable();
        void navigator.createNewChatInSameProject().then(async (created) => {
          if (!created || safeMode) {
            recovery.observeError('SCRIPT_INCOMPATIBLE', now());
            render();
            return;
          }

          const submitted = await submitResumeAfterRollover(
            adapter,
            sessionIdentity,
            () => safeMode,
          );
          if (!submitted || safeMode) {
            recovery.observeError('COMPOSER_UNAVAILABLE', now());
            render();
            return;
          }

          recovery.resetRecovery(now());
          autopilot.enable();
          render();
        });
        return true;
      },
      pause: (reason) => autopilot.pause(reason),
    },
  );

  const render = (): void => {
    const auto = autopilot.getSnapshot();
    const recoverySnapshot: RecoverySnapshot = recovery.getSnapshot();
    control.render({
      state: auto.state,
      enabled: auto.enabled,
      safeMode,
      recoveryState: recoverySnapshot.state,
      sessionId: auto.sessionId,
      rolloverIndex: auto.rolloverIndex,
      successfulTurns: auto.successfulTurns,
      generationEpoch: auto.generationEpoch,
    });
  };

  const recoveryIsArmed = (): boolean => {
    const snapshot = autopilot.getSnapshot();
    return snapshot.enabled && snapshot.state !== 'DISABLED' && snapshot.state !== 'PAUSED';
  };

  const inspectRecovery = (relevantActivity = false): void => {
    if (!recoveryIsArmed()) return;
    const timestamp = now();
    if (relevantActivity) recovery.onRelevantActivity(timestamp);
    recovery.observeError(classifyUiError(adapter.getRecoveryUiSignals()), timestamp);
  };

  const advanceRecovery = (): void => {
    if (safeMode || !recoveryIsArmed()) return;
    const timestamp = now();
    recovery.tick(timestamp);
    const state = recovery.getSnapshot().state;

    if (state === 'STOPPING' && !adapter.isGenerating()) {
      if (!recovery.requestRegenerate(timestamp)) recovery.requestReload(timestamp);
    } else if (state === 'GENERATION_ERROR') {
      if (!recovery.requestRegenerate(timestamp)) recovery.requestReload(timestamp);
    } else if (state === 'CONVERSATION_EXHAUSTED') {
      if (!recovery.requestRollover(timestamp)) autopilot.pause('project rollover unavailable');
    }
    render();
  };

  const control = new AutopilotControl({
    document: doc,
    hotkey: settings.hotkey,
    callbacks: {
      onToggle: () => {
        if (safeMode) return;
        if (autopilot.getSnapshot().enabled) {
          autopilot.disable();
        } else {
          autopilot.enable();
          inspectRecovery();
          advanceRecovery();
        }
        render();
      },
      onPause: () => {
        if (!safeMode) autopilot.pause('paused by user');
        render();
      },
      onStop: () => {
        autopilot.disable();
        render();
      },
      onSafeMode: () => {
        safeMode = !safeMode;
        autopilot.disable();
        render();
      },
      onResetRecovery: () => {
        if (!safeMode) recovery.resetRecovery(now());
        render();
      },
      onOpenSettings: () => openSettingsDialog(doc, settings, settingsStore),
    },
  });

  control.mount();
  autopilot.start();
  inspectRecovery();
  render();

  const disconnectRecoveryObserver = adapter.observeRelevantActivity(() => {
    inspectRecovery(true);
    advanceRecovery();
  });
  const recoveryTimer = setInterval(advanceRecovery, settings.watchdogMs);

  const view = doc.defaultView;
  const handleOffline = (): void => {
    recovery.setOnline(false, now());
    render();
  };
  const handleOnline = (): void => {
    recovery.setOnline(true, now());
    render();
  };
  view?.addEventListener('offline', handleOffline);
  view?.addEventListener('online', handleOnline);
  if (view && !view.navigator.onLine) recovery.setOnline(false, now());

  options.registerMenuCommand('Autopilot: toggle', () => {
    if (safeMode) return;
    if (autopilot.getSnapshot().enabled) {
      autopilot.disable();
    } else {
      autopilot.enable();
      inspectRecovery();
      advanceRecovery();
    }
    render();
  });
  options.registerMenuCommand('Autopilot: emergency stop', () => {
    autopilot.disable();
    render();
  });
  options.registerMenuCommand('Autopilot: toggle Safe Mode', () => {
    safeMode = !safeMode;
    autopilot.disable();
    render();
  });
  options.registerMenuCommand('Autopilot: settings', () =>
    openSettingsDialog(doc, settings, settingsStore),
  );

  return {
    autopilot,
    recovery,
    navigator,
    control,
    dispose: () => {
      clearInterval(recoveryTimer);
      disconnectRecoveryObserver();
      view?.removeEventListener('offline', handleOffline);
      view?.removeEventListener('online', handleOnline);
      autopilot.stop();
      control.unmount();
      doc.getElementById('chatgpt-autopilot-settings')?.remove();
    },
  };
}

declare const GM_getValue: (<T>(key: string, defaultValue: T) => T | Promise<T>) | undefined;
declare const GM_setValue: (<T>(key: string, value: T) => void | Promise<void>) | undefined;
declare const GM_registerMenuCommand: ((name: string, callback: () => void) => unknown) | undefined;

if (
  typeof document !== 'undefined' &&
  typeof GM_getValue === 'function' &&
  typeof GM_setValue === 'function' &&
  typeof GM_registerMenuCommand === 'function'
) {
  void bootstrapAutopilot({
    document,
    storage: {
      getValue: <T>(key: string, fallback: T) => GM_getValue(key, fallback),
      setValue: <T>(key: string, value: T) => GM_setValue(key, value),
    },
    registerMenuCommand: GM_registerMenuCommand,
  });
}
