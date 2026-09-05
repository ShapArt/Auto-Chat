const COMPOSER_SELECTOR = '#prompt-textarea';
const SUBMIT_SELECTOR = '#composer-submit-button';
const STOP_SELECTOR = '[data-testid="stop-button"]';
const SAFETY_CHECK_SELECTOR = '[data-streaming-response-status]';

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
    return this.findStopButton() !== null;
  }

  isSafetyCheckActive(): boolean {
    const indicator = this.doc.querySelector<HTMLElement>(SAFETY_CHECK_SELECTOR);
    return indicator !== null && this.isVisible(indicator);
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
      if (mutations.length > 0) callback();
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
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

  private isVisible(element: HTMLElement): boolean {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = this.doc.defaultView?.getComputedStyle(element);
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden';
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
