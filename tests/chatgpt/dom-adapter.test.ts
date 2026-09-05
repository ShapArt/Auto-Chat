import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptDomAdapter } from '../../src/chatgpt/dom-adapter';
import errorHtml from '../fixtures/chatgpt-error.html?raw';
import idleHtml from '../fixtures/chatgpt-idle.html?raw';
import manualInputHtml from '../fixtures/chatgpt-manual-input.html?raw';
import safetyCheckHtml from '../fixtures/chatgpt-safety-check.html?raw';
import streamingHtml from '../fixtures/chatgpt-streaming.html?raw';

type FixtureName =
  | 'chatgpt-idle.html'
  | 'chatgpt-streaming.html'
  | 'chatgpt-manual-input.html'
  | 'chatgpt-error.html'
  | 'chatgpt-safety-check.html';

const FIXTURES: Record<FixtureName, string> = {
  'chatgpt-idle.html': idleHtml,
  'chatgpt-streaming.html': streamingHtml,
  'chatgpt-manual-input.html': manualInputHtml,
  'chatgpt-error.html': errorHtml,
  'chatgpt-safety-check.html': safetyCheckHtml,
};

function loadFixture(name: FixtureName): void {
  const parsed = new DOMParser().parseFromString(FIXTURES[name], 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

describe('ChatGptDomAdapter', () => {
  beforeEach(() => {
    loadFixture('chatgpt-idle.html');
  });

  it('finds the ProseMirror composer and submit button by stable ids', () => {
    const adapter = new ChatGptDomAdapter(document);

    expect(adapter.findComposer()?.id).toBe('prompt-textarea');
    expect(adapter.findComposer()?.getAttribute('contenteditable')).toBe('true');
    expect(adapter.findSubmitButton()?.id).toBe('composer-submit-button');
  });

  it('falls back to the current send-button test id when the legacy submit id is absent', () => {
    const button = document.querySelector('#composer-submit-button') as HTMLButtonElement;
    button.removeAttribute('id');
    button.setAttribute('data-testid', 'send-button');
    const onClick = vi.fn();
    button.addEventListener('click', onClick);

    const adapter = new ChatGptDomAdapter(document);
    expect(adapter.findSubmitButton()).toBe(button);
    expect(adapter.canSubmit()).toBe(true);
    expect(adapter.submitPrompt()).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('detects generation from the stop-button test id rather than aria text', () => {
    loadFixture('chatgpt-streaming.html');
    const adapter = new ChatGptDomAdapter(document);

    expect(adapter.findStopButton()).not.toBeNull();
    expect(adapter.isGenerating()).toBe(true);
    expect(adapter.canSubmit()).toBe(false);
  });

  it('does not treat signals inside hidden ancestor containers as visible', () => {
    loadFixture('chatgpt-streaming.html');
    const stop = document.querySelector('[data-testid="stop-button"]') as HTMLElement;
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    stop.parentElement?.insertBefore(hidden, stop);
    hidden.append(stop);

    const adapter = new ChatGptDomAdapter(document);
    expect(adapter.findStopButton()).toBeNull();
    expect(adapter.isGenerating()).toBe(false);

    loadFixture('chatgpt-idle.html');
    const alertWrapper = document.createElement('div');
    alertWrapper.hidden = true;
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.textContent = "You've reached the maximum length for this conversation.";
    alertWrapper.append(alert);
    document.querySelector('main')?.append(alertWrapper);

    const recoveryAdapter = new ChatGptDomAdapter(document);
    expect(recoveryAdapter.getRecoveryUiSignals().conversationLimit).toBe(false);
  });

  it('keeps generation active when an assistant turn is aria-busy even if the stop button disappears', () => {
    loadFixture('chatgpt-streaming.html');
    document.querySelector('[data-testid="stop-button"]')?.remove();
    const assistantTurn = document.createElement('article');
    assistantTurn.setAttribute('data-message-author-role', 'assistant');
    assistantTurn.setAttribute('aria-busy', 'true');
    document.querySelector('main')?.append(assistantTurn);

    const adapter = new ChatGptDomAdapter(document);
    expect(adapter.findStopButton()).toBeNull();
    expect(adapter.isGenerating()).toBe(true);
  });

  it('detects the structural extended-processing signal', () => {
    loadFixture('chatgpt-safety-check.html');
    const adapter = new ChatGptDomAdapter(document);

    expect(adapter.isSafetyCheckActive()).toBe(true);
  });

  it('exposes visible recovery signals without treating assistant text as a blocker', () => {
    loadFixture('chatgpt-error.html');
    const errorAdapter = new ChatGptDomAdapter(document);
    expect(errorAdapter.getRecoveryUiSignals().generationFailed).toBe(true);

    loadFixture('chatgpt-idle.html');
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.textContent =
      "You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.";
    document.querySelector('main')?.append(alert);
    const limitAdapter = new ChatGptDomAdapter(document);
    expect(limitAdapter.getRecoveryUiSignals().conversationLimit).toBe(true);

    alert.remove();
    const assistantText = document.createElement('article');
    assistantText.setAttribute('data-message-author-role', 'assistant');
    assistantText.textContent =
      "You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.";
    document.querySelector('main')?.append(assistantText);
    expect(limitAdapter.getRecoveryUiSignals().conversationLimit).toBe(false);
  });

  it('never overwrites non-empty manual composer text', () => {
    loadFixture('chatgpt-manual-input.html');
    const adapter = new ChatGptDomAdapter(document);
    const composer = adapter.findComposer();

    expect(adapter.isComposerEmpty()).toBe(false);
    expect(adapter.insertComposerText('Continue safely')).toBe(false);
    expect(composer?.textContent).toContain('Manual draft');
    expect(composer?.textContent).not.toContain('Continue safely');
  });

  it('inserts text into an empty contenteditable and emits an input event', () => {
    const adapter = new ChatGptDomAdapter(document);
    const composer = adapter.findComposer();
    const onInput = vi.fn();
    composer?.addEventListener('input', onInput);

    expect(adapter.isComposerEmpty()).toBe(true);
    expect(adapter.insertComposerText('Continue safely')).toBe(true);
    expect(composer?.textContent).toBe('Continue safely');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('clicks submit only while idle and enabled', () => {
    const adapter = new ChatGptDomAdapter(document);
    const button = adapter.findSubmitButton();
    const onClick = vi.fn();
    button?.addEventListener('click', onClick);

    expect(adapter.canSubmit()).toBe(true);
    expect(adapter.submitPrompt()).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);

    loadFixture('chatgpt-streaming.html');
    const streamingAdapter = new ChatGptDomAdapter(document);
    expect(streamingAdapter.submitPrompt()).toBe(false);
  });

  it('observes relevant DOM mutations and can disconnect cleanly', async () => {
    const adapter = new ChatGptDomAdapter(document);
    const onActivity = vi.fn();
    const disconnect = adapter.observeRelevantActivity(onActivity);

    adapter.findSubmitButton()?.setAttribute('disabled', '');
    await Promise.resolve();
    expect(onActivity).toHaveBeenCalled();

    disconnect();
    const callsAfterDisconnect = onActivity.mock.calls.length;
    adapter.findSubmitButton()?.removeAttribute('disabled');
    await Promise.resolve();
    expect(onActivity).toHaveBeenCalledTimes(callsAfterDisconnect);
  });

  it('ignores mutations inside userscript-owned DOM', async () => {
    const owned = document.createElement('div');
    owned.setAttribute('data-chatgpt-autopilot-owned', 'true');
    document.body.append(owned);

    const adapter = new ChatGptDomAdapter(document);
    const onActivity = vi.fn();
    const disconnect = adapter.observeRelevantActivity(onActivity);

    owned.textContent = 'AUTO · generating';
    await Promise.resolve();
    expect(onActivity).not.toHaveBeenCalled();

    adapter.findSubmitButton()?.setAttribute('disabled', '');
    await Promise.resolve();
    expect(onActivity).toHaveBeenCalledTimes(1);

    disconnect();
  });
});