import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptDomAdapter } from '../../src/chatgpt/dom-adapter';

function loadFixture(name: string): void {
  const html = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  document.documentElement.innerHTML = html;
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

  it('detects generation from the stop-button test id rather than aria text', () => {
    loadFixture('chatgpt-streaming.html');
    const adapter = new ChatGptDomAdapter(document);

    expect(adapter.findStopButton()).not.toBeNull();
    expect(adapter.isGenerating()).toBe(true);
    expect(adapter.canSubmit()).toBe(false);
  });

  it('detects the structural extended-processing signal', () => {
    loadFixture('chatgpt-safety-check.html');
    const adapter = new ChatGptDomAdapter(document);

    expect(adapter.isSafetyCheckActive()).toBe(true);
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
});
