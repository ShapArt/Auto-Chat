import type { RecoveryUiSignals } from '../recovery/error-classifier';

const COMPOSER_SELECTOR = '#prompt-textarea';
const SUBMIT_SELECTOR = '#composer-submit-button';
const STOP_SELECTOR = '[data-testid="stop-button"]';
const ASSISTANT_BUSY_SELECTOR = '[data-message-author-role="assistant"][aria-busy="true"]';
const SAFETY_CHECK_SELECTOR = '[data-streaming-response-status]';
const GENERATION_ERROR_SELECTOR = '[data-testid="conversation-turn-error"]';
const SYSTEM_SURFACE_SELECTOR = '[role="alert"], [role="dialog"]';
const USERSCRIPT_OWNED_SELECTOR = '[data-chatgpt-autopilot-owned="true"]';

function normalizedText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/[\u200B\uFEFF]/g, '').trim();
}

export class ChatGptDomAdapter {
  constructor(private readonly doc: Document = document) {}

  findComposer(): HTMLElement | null {
    const composer = this.doc.querySelector<HTMLElement>(COMPOSER_SELECTOR);
    if (!composer || composer.getAttribute('contenteditable') !== 'true') return null;
    return composer;
  }

  findSubmitButton(): HTMLButtonElement | null {
    return this.doc.querySelector<HTMLButtonElement>(SUBMIT_SELECTOR);
  }

  findStopButton(): HTMLButtonElement | null {
    const button = this.doc.querySelector<HTMLButtonElement>(STOP_SELECTOR);
    return button && this.isVisible(button) ? button : null;
  }

  isGenerating(): boolean {
    if (this.findStopButton() !== null) return true;
    const busyAssistant = this.doc.querySelector<HTMLElement>(ASSISTANT_BUSY_SELECTOR);
    return busyAssistant !== null && this.isVisible(busyAssistant);
  }

  isSafetyCheckActive(): boolean {
    const indicator = this.doc.querySelector<HTMLElement>(SAFETY_CHECK_SELECTOR);
    return indicator !== null && this.isVisible(indicator);
  }

  getRecoveryUiSignals(): RecoveryUiSignals {
    const systemText = this.getVisibleSystemSurfaceText();
    const generationError = this.doc.querySelector<HTMLElement>(GENERATION_ERROR_SELECTOR);

    return {
      safetyCheck: this.isSafetyCheckActive(),
      generationFailed: generationError !== null && this.isVisible(generationError),
      networkError: /\bnetwork error\b|\bconnection (?:lost|error)\b/i.test(systemText),
      websocketError: /\bwebsocket\b/i.test(systemText),
      rateLimit: /\brate limit\b|\btoo many requests\b/i.test(systemText),
      usageLimit:
        /\busage limit\b|(?:you(?:'|’)ve|you have) (?:hit|reached) (?:your )?(?:message|usage) limit/i.test(
          systemText,
        ),
      loginRequired: /\b(?:log in|sign in)\b[^.]{0,120}\b(?:continue|chatgpt|account)\b/i.test(
        systemText,
      ),
      verificationRequired:
        /\bverification required\b|\bverify (?:you are|you're|your account)\b|\bcaptcha\b/i.test(
          systemText,
        ),
      conversationLimit:
        /\bmaximum length for this conversation\b/i.test(systemText) ||
        /\bconversation is too long,?\s*please start a new one\b/i.test(systemText),
      composerUnavailable: false,
      pageBroken: false,
      scriptIncompatible: false,
    };
  }

  isComposerEmpty(): boolean {
    const composer = this.findComposer();
    return composer !== null && normalizedText(composer).length === 0;
  }

  canSubmit(): boolean {
    const button = this.findSubmitButton();
    if (!button || this.isGenerating()) return false;
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    return this.findComposer() !== null && this.isVisible(button);
  }

  insertComposerText(text: string): boolean {
    if (text.trim().length === 0) return false;

    const composer = this.findComposer();
    if (!composer || !this.isComposerEmpty()) return false;

    composer.focus();
    this.selectContents(composer);

    if (this.tryEditingCommand(text, composer)) {
      return normalizedText(composer) === text.trim();
    }

    composer.replaceChildren(this.doc.createTextNode(text));
    composer.dispatchEvent(this.createInputEvent(text));
    return normalizedText(composer) === text.trim();
  }

  submitPrompt(): boolean {
    if (!this.canSubmit()) return false;
    const button = this.findSubmitButton();
    if (!button) return false;
    button.click();
    return true;
  }

  observeRelevantActivity(callback: () => void): () => void {
    const root = this.doc.body ?? this.doc.documentElement;
    const MutationObserverCtor = this.doc.defaultView?.MutationObserver;
    if (!root || !MutationObserverCtor) return () => undefined;

    const observer = new MutationObserverCtor((mutations) => {
      if (mutations.some((mutation) => !this.isUserscriptOwnedMutation(mutation))) callback();
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'aria-busy',
        'aria-disabled',
        'contenteditable',
        'data-testid',
        'disabled',
        'hidden',
        'style',
      ],
    });

    return () => observer.disconnect();
  }

  private getVisibleSystemSurfaceText(): string {
    const texts: string[] = [];
    const surfaces = this.doc.querySelectorAll<HTMLElement>(SYSTEM_SURFACE_SELECTOR);

    for (const surface of surfaces) {
      if (!this.isVisible(surface)) continue;
      if (surface.closest(USERSCRIPT_OWNED_SELECTOR)) continue;
      if (surface.closest('[data-message-author-role]')) continue;
      if (surface.closest('nav, aside')) continue;

      const text = normalizedText(surface);
      if (text.length > 0) texts.push(text);
    }

    return texts.join('\n');
  }

  private isUserscriptOwnedMutation(mutation: MutationRecord): boolean {
    if (this.isUserscriptOwnedNode(mutation.target)) return true;
    if (mutation.type !== 'childList') return false;

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return (
      changedNodes.length > 0 && changedNodes.every((node) => this.isUserscriptOwnedNode(node))
    );
  }

  private isUserscriptOwnedNode(node: Node): boolean {
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    return element?.closest(USERSCRIPT_OWNED_SELECTOR) !== null;
  }

  private isVisible(element: HTMLElement): boolean {
    const view = this.doc.defaultView;
    let current: HTMLElement | null = element;

    while (current) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
      const style = view?.getComputedStyle(current);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      current = current.parentElement;
    }

    return true;
  }

  private selectContents(element: HTMLElement): void {
    const selection = this.doc.getSelection();
    if (!selection) return;
    const range = this.doc.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private tryEditingCommand(text: string, composer: HTMLElement): boolean {
    const commandDocument = this.doc as Document & {
      execCommand?: (commandId: string, showUI?: boolean, value?: string) => boolean;
      queryCommandSupported?: (command: string) => boolean;
    };

    if (typeof commandDocument.execCommand !== 'function') return false;
    if (
      typeof commandDocument.queryCommandSupported === 'function' &&
      !commandDocument.queryCommandSupported('insertText')
    ) {
      return false;
    }

    try {
      const succeeded = commandDocument.execCommand('insertText', false, text);
      return succeeded && normalizedText(composer).length > 0;
    } catch {
      return false;
    }
  }

  private createInputEvent(text: string): Event {
    const InputEventCtor = this.doc.defaultView?.InputEvent;
    if (!InputEventCtor) return new Event('input', { bubbles: true, composed: true });

    return new InputEventCtor('input', {
      bubbles: true,
      composed: true,
      data: text,
      inputType: 'insertText',
    });
  }
}
