// ==UserScript==
// @name         ChatGPT Autopilot
// @namespace    https://github.com/ShapArt/Auto-Chat
// @version      0.1.0
// @description  Privacy-first, project-aware continuation autopilot for ChatGPT.
// @author       ShapArt
// @license      MIT
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
"use strict";
(() => {
  // src/chatgpt/dom-adapter.ts
  var COMPOSER_SELECTOR = "#prompt-textarea";
  var SUBMIT_SELECTOR = '#composer-submit-button, button[data-testid="send-button"]';
  var STOP_SELECTOR = '[data-testid="stop-button"]';
  var ASSISTANT_BUSY_SELECTOR = '[data-message-author-role="assistant"][aria-busy="true"]';
  var SAFETY_CHECK_SELECTOR = "[data-streaming-response-status]";
  var GENERATION_ERROR_SELECTOR = '[data-testid="conversation-turn-error"]';
  var SYSTEM_SURFACE_SELECTOR = '[role="alert"], [role="dialog"]';
  var USERSCRIPT_OWNED_SELECTOR = '[data-chatgpt-autopilot-owned="true"]';
  function normalizedText(element) {
    return (element.textContent ?? "").replace(/[\u200B\uFEFF]/g, "").trim();
  }
  var ChatGptDomAdapter = class {
    constructor(doc = document) {
      this.doc = doc;
    }
    doc;
    findComposer() {
      const composer = this.doc.querySelector(COMPOSER_SELECTOR);
      if (!composer || composer.getAttribute("contenteditable") !== "true") return null;
      return composer;
    }
    findSubmitButton() {
      return this.doc.querySelector(SUBMIT_SELECTOR);
    }
    findStopButton() {
      const button2 = this.doc.querySelector(STOP_SELECTOR);
      return button2 && this.isVisible(button2) ? button2 : null;
    }
    isGenerating() {
      if (this.findStopButton() !== null) return true;
      const busyAssistant = this.doc.querySelector(ASSISTANT_BUSY_SELECTOR);
      return busyAssistant !== null && this.isVisible(busyAssistant);
    }
    isSafetyCheckActive() {
      const indicator = this.doc.querySelector(SAFETY_CHECK_SELECTOR);
      return indicator !== null && this.isVisible(indicator);
    }
    getRecoveryUiSignals() {
      const systemText = this.getVisibleSystemSurfaceText();
      const generationError = this.doc.querySelector(GENERATION_ERROR_SELECTOR);
      return {
        safetyCheck: this.isSafetyCheckActive(),
        generationFailed: generationError !== null && this.isVisible(generationError),
        networkError: /\bnetwork error\b|\bconnection (?:lost|error)\b/i.test(systemText),
        websocketError: /\bwebsocket\b/i.test(systemText),
        rateLimit: /\brate limit\b|\btoo many requests\b/i.test(systemText),
        usageLimit: /\busage limit\b|(?:you(?:'|’)ve|you have) (?:hit|reached) (?:your )?(?:message|usage) limit/i.test(
          systemText
        ),
        loginRequired: /\b(?:log in|sign in)\b[^.]{0,120}\b(?:continue|chatgpt|account)\b/i.test(
          systemText
        ),
        verificationRequired: /\bverification required\b|\bverify (?:you are|you're|your account)\b|\bcaptcha\b/i.test(
          systemText
        ),
        conversationLimit: /\bmaximum length for this conversation\b/i.test(systemText) || /\bconversation is too long,?\s*please start a new one\b/i.test(systemText),
        composerUnavailable: false,
        pageBroken: false,
        scriptIncompatible: false
      };
    }
    isComposerEmpty() {
      const composer = this.findComposer();
      return composer !== null && normalizedText(composer).length === 0;
    }
    composerMatchesText(text) {
      const composer = this.findComposer();
      return composer !== null && normalizedText(composer) === text.trim();
    }
    canSubmit() {
      const button2 = this.findSubmitButton();
      if (!button2 || this.isGenerating()) return false;
      if (button2.disabled || button2.getAttribute("aria-disabled") === "true") return false;
      return this.findComposer() !== null && this.isVisible(button2);
    }
    insertComposerText(text) {
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
    submitPrompt() {
      if (!this.canSubmit()) return false;
      const button2 = this.findSubmitButton();
      if (!button2) return false;
      button2.click();
      return true;
    }
    observeRelevantActivity(callback) {
      const root = this.doc.body ?? this.doc.documentElement;
      const MutationObserverCtor = this.doc.defaultView?.MutationObserver;
      if (!root || !MutationObserverCtor) return () => void 0;
      const observer = new MutationObserverCtor((mutations) => {
        if (mutations.some((mutation) => !this.isUserscriptOwnedMutation(mutation))) callback();
      });
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "aria-busy",
          "aria-disabled",
          "contenteditable",
          "data-testid",
          "disabled",
          "hidden",
          "style"
        ]
      });
      return () => observer.disconnect();
    }
    getVisibleSystemSurfaceText() {
      const texts = [];
      const surfaces = this.doc.querySelectorAll(SYSTEM_SURFACE_SELECTOR);
      for (const surface of surfaces) {
        if (!this.isVisible(surface)) continue;
        if (surface.closest(USERSCRIPT_OWNED_SELECTOR)) continue;
        if (surface.closest("[data-message-author-role]")) continue;
        if (surface.closest("nav, aside")) continue;
        const text = normalizedText(surface);
        if (text.length > 0) texts.push(text);
      }
      return texts.join("\n");
    }
    isUserscriptOwnedMutation(mutation) {
      if (this.isUserscriptOwnedNode(mutation.target)) return true;
      if (mutation.type !== "childList") return false;
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.length > 0 && changedNodes.every((node) => this.isUserscriptOwnedNode(node));
    }
    isUserscriptOwnedNode(node) {
      const element = node.nodeType === 1 ? node : node.parentElement;
      return element?.closest(USERSCRIPT_OWNED_SELECTOR) !== null;
    }
    isVisible(element) {
      const view = this.doc.defaultView;
      let current = element;
      while (current) {
        if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
        const style = view?.getComputedStyle(current);
        if (style && (style.display === "none" || style.visibility === "hidden")) return false;
        current = current.parentElement;
      }
      return true;
    }
    selectContents(element) {
      const selection = this.doc.getSelection();
      if (!selection) return;
      const range = this.doc.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    tryEditingCommand(text, composer) {
      const commandDocument = this.doc;
      if (typeof commandDocument.execCommand !== "function") return false;
      if (typeof commandDocument.queryCommandSupported === "function" && !commandDocument.queryCommandSupported("insertText")) {
        return false;
      }
      try {
        const succeeded = commandDocument.execCommand("insertText", false, text);
        return succeeded && normalizedText(composer).length > 0;
      } catch {
        return false;
      }
    }
    createInputEvent(text) {
      const InputEventCtor = this.doc.defaultView?.InputEvent;
      if (!InputEventCtor) return new Event("input", { bubbles: true, composed: true });
      return new InputEventCtor("input", {
        bubbles: true,
        composed: true,
        data: text,
        inputType: "insertText"
      });
    }
  };

  // src/core/state-machine.ts
  function transition(state, event) {
    if (event.type === "DISABLE") return "DISABLED";
    if (state === "DISABLED") {
      return event.type === "ENABLE" ? "ARMED" : "DISABLED";
    }
    if (event.type === "MANUAL_INPUT" || event.type === "CONVERSATION_CHANGED" || event.type === "PAUSE") {
      return "PAUSED";
    }
    if (event.type === "FAIL") return "ERROR";
    switch (event.type) {
      case "GENERATION_STARTED":
        return state === "ARMED" || state === "COOLDOWN" || state === "SETTLING" ? "GENERATING" : state;
      case "GENERATION_STOPPED":
        return state === "GENERATING" ? "SETTLING" : state;
      case "SETTLED":
        return state === "SETTLING" ? "READY" : state;
      case "SUBMIT_STARTED":
        return state === "READY" ? "SUBMITTING" : state;
      case "SUBMIT_SUCCEEDED":
        return state === "SUBMITTING" ? "COOLDOWN" : state;
      case "NEXT_GENERATION_STARTED":
        return state === "COOLDOWN" ? "GENERATING" : state;
      case "ENABLE":
        return state;
    }
  }

  // src/navigation/project-navigator.ts
  var PROJECT_ROUTE = /^\/g\/(g-p-[^/]+)\/(?:project|c\/([^/?#]+))(?:\/|$)/;
  var ROOT_CONVERSATION_ROUTE = /^\/c\/([^/?#]+)(?:\/|$)/;
  var DEFAULT_NAVIGATION_TIMEOUT_MS = 5e3;
  var DEFAULT_NAVIGATION_POLL_MS = 100;
  function normalizePath(path) {
    const value = path.trim();
    if (value.length === 0) return "/";
    try {
      return new URL(value, "https://chatgpt.com").pathname;
    } catch {
      return value.split(/[?#]/, 1)[0] || "/";
    }
  }
  function parseContext(pathValue) {
    const path = normalizePath(pathValue);
    const projectMatch = PROJECT_ROUTE.exec(path);
    if (projectMatch) {
      const projectKey = projectMatch[1] ?? null;
      const conversationKey = projectMatch[2] ?? path;
      return { projectKey, conversationKey, path };
    }
    const rootMatch = ROOT_CONVERSATION_ROUTE.exec(path);
    return {
      projectKey: null,
      conversationKey: rootMatch?.[1] ?? path,
      path
    };
  }
  function projectHomePath(projectKey) {
    return `/g/${projectKey}/project`;
  }
  function isVisible(element) {
    const view = element.ownerDocument.defaultView;
    let current = element;
    while (current) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      const style = view?.getComputedStyle(current);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
      current = current.parentElement;
    }
    return true;
  }
  function defaultRandomSuffix() {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(6);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
    }
    return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  }
  function createSessionIdentity(now = /* @__PURE__ */ new Date(), randomSuffix = defaultRandomSuffix) {
    const year = now.getUTCFullYear().toString().padStart(4, "0");
    const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = now.getUTCDate().toString().padStart(2, "0");
    const suffix = randomSuffix().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "000000";
    return {
      sessionId: `auto-${year}${month}${day}-${suffix}`,
      rolloverIndex: 0
    };
  }
  function buildResumePrompt(identity) {
    return [
      "[AUTOPILOT_RESUME]",
      `sessionId: ${identity.sessionId}`,
      `rolloverIndex: ${identity.rolloverIndex}`,
      "Continue the existing workflow using Project context and the latest AUTOPILOT_CHECKPOINT_V1 if available.",
      "Do not repeat completed work. Continue from the next concrete step and preserve the original requirements."
    ].join("\n");
  }
  function buildContinuationPrompt(settings, successfulTurns, identity) {
    const checkpointDue = settings.checkpointEvery > 0 && successfulTurns > 0 && successfulTurns % settings.checkpointEvery === 0;
    if (!checkpointDue) return settings.continuationPrompt;
    return [
      settings.continuationPrompt,
      "",
      "[AUTOPILOT_CHECKPOINT_REQUEST]",
      `sessionId: ${identity.sessionId}`,
      `rolloverIndex: ${identity.rolloverIndex}`,
      "Before finishing this response, append a concise AUTOPILOT_CHECKPOINT_V1 with completed steps, current technical state, the next concrete step, and blockers if any.",
      "The userscript will not parse this checkpoint; it exists only for Project-context continuity."
    ].join("\n");
  }
  var ProjectNavigator = class {
    constructor(identity, options = {}) {
      this.identity = identity;
      this.doc = options.document ?? globalThis.document;
      this.getPath = options.getPath ?? (() => globalThis.location?.pathname ?? "/");
      this.waitForNavigationOverride = options.waitForNavigation;
    }
    identity;
    doc;
    getPath;
    waitForNavigationOverride;
    captureContext() {
      return parseContext(this.getPath());
    }
    contextChanged(previous) {
      const current = this.captureContext();
      return current.path !== previous.path || current.projectKey !== previous.projectKey || current.conversationKey !== previous.conversationKey;
    }
    canRollover(previous) {
      if (!previous.projectKey) return false;
      const current = this.captureContext();
      if (current.projectKey !== previous.projectKey) return false;
      const homePath = projectHomePath(previous.projectKey);
      if (current.path === homePath) return false;
      return this.findProjectHomeLink(previous.projectKey) !== null;
    }
    async createNewChatInSameProject() {
      const previous = this.captureContext();
      if (!previous.projectKey || !this.canRollover(previous)) return false;
      const homePath = projectHomePath(previous.projectKey);
      const link = this.findProjectHomeLink(previous.projectKey);
      if (!link) return false;
      link.click();
      const confirmed = await this.waitForNavigation((path) => {
        const current = parseContext(path);
        return current.projectKey === previous.projectKey && current.path === homePath && current.conversationKey !== previous.conversationKey;
      });
      if (!confirmed) return false;
      this.identity.rolloverIndex += 1;
      return true;
    }
    findProjectHomeLink(projectKey) {
      const expectedPath = projectHomePath(projectKey);
      const anchors = this.doc.querySelectorAll("a[href]");
      for (const anchor of anchors) {
        if (!isVisible(anchor)) continue;
        const href = anchor.getAttribute("href");
        if (!href) continue;
        try {
          const url = new URL(href, "https://chatgpt.com");
          if (url.origin === "https://chatgpt.com" && url.pathname === expectedPath) return anchor;
        } catch {
        }
      }
      return null;
    }
    async waitForNavigation(predicate) {
      if (this.waitForNavigationOverride) return this.waitForNavigationOverride(predicate);
      const startedAt = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          if (predicate(this.getPath())) {
            resolve(true);
            return;
          }
          if (Date.now() - startedAt >= DEFAULT_NAVIGATION_TIMEOUT_MS) {
            resolve(false);
            return;
          }
          setTimeout(check, DEFAULT_NAVIGATION_POLL_MS);
        };
        check();
      });
    }
  };

  // src/utils/logger.ts
  var Logger = class {
    constructor(enabled = false, sink = console) {
      this.enabled = enabled;
      this.sink = sink;
    }
    enabled;
    sink;
    setEnabled(enabled) {
      this.enabled = enabled;
    }
    debug(message, details) {
      if (!this.enabled) return;
      if (details) this.sink.debug(`[ChatGPT Autopilot] ${message}`, details);
      else this.sink.debug(`[ChatGPT Autopilot] ${message}`);
    }
    warn(message, details) {
      if (!this.enabled) return;
      if (details) this.sink.warn(`[ChatGPT Autopilot] ${message}`, details);
      else this.sink.warn(`[ChatGPT Autopilot] ${message}`);
    }
    error(message, details) {
      if (!this.enabled) return;
      if (details) this.sink.error(`[ChatGPT Autopilot] ${message}`, details);
      else this.sink.error(`[ChatGPT Autopilot] ${message}`);
    }
  };

  // src/core/autopilot.ts
  var SUBMIT_READY_POLL_MS = 50;
  var SUBMIT_READY_TIMEOUT_MS = 2e3;
  var Autopilot = class {
    constructor(adapter, settings, options = {}) {
      this.adapter = adapter;
      this.settings = settings;
      this.getConversationKey = options.getConversationKey ?? (() => globalThis.location?.pathname ?? "");
      this.onStateChange = options.onStateChange;
      this.logger = options.logger ?? new Logger(settings.debug);
      this.sessionIdentity = options.sessionIdentity ?? createSessionIdentity();
    }
    adapter;
    settings;
    state = "DISABLED";
    enabled = false;
    pauseReason = null;
    errorReason = null;
    generationEpoch = 0;
    submittedEpoch = -1;
    successfulTurns = 0;
    conversationKey = "";
    started = false;
    settleTimer = null;
    submitReadyTimer = null;
    postSubmitTimer = null;
    watchdogTimer = null;
    disconnectObserver = null;
    getConversationKey;
    onStateChange;
    logger;
    sessionIdentity;
    start() {
      if (this.started) return;
      this.started = true;
      this.disconnectObserver = this.adapter.observeRelevantActivity(() => this.evaluate());
      this.watchdogTimer = setInterval(() => this.evaluate(), this.settings.watchdogMs);
    }
    stop() {
      this.disable();
      this.disconnectObserver?.();
      this.disconnectObserver = null;
      if (this.watchdogTimer !== null) clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
      this.started = false;
    }
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      this.pauseReason = null;
      this.errorReason = null;
      this.conversationKey = this.getConversationKey();
      this.setState(transition(this.state, { type: "ENABLE" }));
      this.evaluate();
    }
    disable() {
      this.enabled = false;
      this.pauseReason = null;
      this.errorReason = null;
      this.cancelAutomationTimers();
      this.setState(transition(this.state, { type: "DISABLE" }));
    }
    pause(reason) {
      if (this.state === "DISABLED") return;
      this.cancelAutomationTimers();
      this.pauseReason = reason;
      this.errorReason = null;
      this.setState(transition(this.state, { type: "PAUSE" }));
    }
    getSnapshot() {
      return {
        state: this.state,
        enabled: this.enabled,
        pauseReason: this.pauseReason,
        errorReason: this.errorReason,
        generationEpoch: this.generationEpoch,
        submittedEpoch: this.submittedEpoch,
        successfulTurns: this.successfulTurns,
        sessionId: this.sessionIdentity.sessionId,
        rolloverIndex: this.sessionIdentity.rolloverIndex
      };
    }
    evaluate() {
      if (!this.enabled) return;
      if (this.state === "DISABLED" || this.state === "PAUSED" || this.state === "ERROR") return;
      if (this.getConversationKey() !== this.conversationKey) {
        this.pause("conversation changed");
        return;
      }
      if (this.isManualInputSensitiveState() && !this.adapter.isComposerEmpty()) {
        this.pause("manual input detected");
        return;
      }
      const generating = this.adapter.isGenerating();
      if (generating) {
        this.cancelPostSubmitTimer();
        if (this.state === "ARMED") {
          this.generationEpoch += 1;
          this.setState(transition(this.state, { type: "GENERATION_STARTED" }));
        } else if (this.state === "COOLDOWN") {
          this.generationEpoch += 1;
          this.setState(transition(this.state, { type: "NEXT_GENERATION_STARTED" }));
        } else if (this.state === "SETTLING") {
          this.cancelSettleTimer();
          this.setState(transition(this.state, { type: "GENERATION_STARTED" }));
        }
        return;
      }
      if (this.state === "GENERATING") {
        this.setState(transition(this.state, { type: "GENERATION_STOPPED" }));
        this.scheduleSettlement(this.generationEpoch);
      }
    }
    scheduleSettlement(epoch) {
      if (this.settleTimer !== null) return;
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.finishSettlement(epoch);
      }, this.settings.completionDebounceMs);
    }
    finishSettlement(epoch) {
      if (!this.enabled || this.state !== "SETTLING" || epoch !== this.generationEpoch) return;
      if (this.getConversationKey() !== this.conversationKey) {
        this.pause("conversation changed");
        return;
      }
      if (this.adapter.isGenerating()) {
        this.setState(transition(this.state, { type: "GENERATION_STARTED" }));
        return;
      }
      if (!this.adapter.isComposerEmpty()) {
        this.pause("manual input detected");
        return;
      }
      this.setState(transition(this.state, { type: "SETTLED" }));
      if (this.settings.sessionTurnLimit > 0 && this.successfulTurns >= this.settings.sessionTurnLimit) {
        this.pause("session turn limit reached");
        return;
      }
      this.submitContinuation(epoch);
    }
    submitContinuation(epoch) {
      if (!this.enabled || this.state !== "READY") return;
      if (this.submittedEpoch === epoch) return;
      if (!this.adapter.isComposerEmpty()) {
        this.pause("manual input detected");
        return;
      }
      const continuationPrompt = buildContinuationPrompt(
        this.settings,
        this.successfulTurns,
        this.sessionIdentity
      );
      this.submittedEpoch = epoch;
      this.setState(transition(this.state, { type: "SUBMIT_STARTED" }));
      if (!this.adapter.insertComposerText(continuationPrompt)) {
        if (!this.adapter.isComposerEmpty()) this.pause("manual input detected");
        else this.fail("continuation insertion failed");
        return;
      }
      this.attemptSubmitWhenReady(epoch, continuationPrompt, Date.now() + SUBMIT_READY_TIMEOUT_MS);
    }
    attemptSubmitWhenReady(epoch, expectedText, deadline) {
      if (!this.enabled || this.state !== "SUBMITTING") return;
      if (epoch !== this.generationEpoch || this.submittedEpoch !== epoch) return;
      if (this.getConversationKey() !== this.conversationKey) {
        this.pause("conversation changed");
        return;
      }
      if (!this.adapter.composerMatchesText(expectedText)) {
        this.pause("manual input detected");
        return;
      }
      if (this.adapter.canSubmit() && this.adapter.submitPrompt()) {
        this.cancelSubmitReadyTimer();
        this.successfulTurns += 1;
        this.setState(transition(this.state, { type: "SUBMIT_SUCCEEDED" }));
        this.schedulePostSubmitGuard();
        return;
      }
      if (Date.now() >= deadline) {
        this.fail("submission failed");
        return;
      }
      this.cancelSubmitReadyTimer();
      this.submitReadyTimer = setTimeout(() => {
        this.submitReadyTimer = null;
        this.attemptSubmitWhenReady(epoch, expectedText, deadline);
      }, SUBMIT_READY_POLL_MS);
    }
    schedulePostSubmitGuard() {
      this.cancelPostSubmitTimer();
      this.postSubmitTimer = setTimeout(() => {
        this.postSubmitTimer = null;
        if (!this.enabled || this.state !== "COOLDOWN") return;
        if (this.adapter.isGenerating()) {
          this.evaluate();
          return;
        }
        this.fail("generation did not start after submission");
      }, this.settings.postSubmitGuardMs);
    }
    fail(reason) {
      this.cancelAutomationTimers();
      this.pauseReason = null;
      this.errorReason = reason;
      this.setState(transition(this.state, { type: "FAIL" }));
    }
    isManualInputSensitiveState() {
      return this.state === "ARMED" || this.state === "GENERATING" || this.state === "SETTLING" || this.state === "READY";
    }
    cancelAutomationTimers() {
      this.cancelSettleTimer();
      this.cancelSubmitReadyTimer();
      this.cancelPostSubmitTimer();
    }
    cancelSettleTimer() {
      if (this.settleTimer !== null) clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    cancelSubmitReadyTimer() {
      if (this.submitReadyTimer !== null) clearTimeout(this.submitReadyTimer);
      this.submitReadyTimer = null;
    }
    cancelPostSubmitTimer() {
      if (this.postSubmitTimer !== null) clearTimeout(this.postSubmitTimer);
      this.postSubmitTimer = null;
    }
    setState(next) {
      if (next === this.state) return;
      const previous = this.state;
      this.state = next;
      this.logger.debug(`state ${previous} -> ${next}`, {
        epoch: this.generationEpoch,
        successfulTurns: this.successfulTurns
      });
      this.onStateChange?.(this.getSnapshot());
    }
  };

  // src/recovery/error-classifier.ts
  var EMPTY_UI_SIGNALS = Object.freeze({
    safetyCheck: false,
    generationFailed: false,
    networkError: false,
    websocketError: false,
    rateLimit: false,
    usageLimit: false,
    loginRequired: false,
    verificationRequired: false,
    conversationLimit: false,
    composerUnavailable: false,
    pageBroken: false,
    scriptIncompatible: false
  });
  function classifyUiError(signals) {
    if (signals.verificationRequired) return "VERIFICATION_REQUIRED";
    if (signals.loginRequired) return "LOGIN_REQUIRED";
    if (signals.usageLimit) return "USAGE_LIMIT";
    if (signals.rateLimit) return "RATE_LIMIT";
    if (signals.safetyCheck) return "SAFETY_CHECK";
    if (signals.conversationLimit) return "CONVERSATION_LIMIT";
    if (signals.pageBroken) return "PAGE_BROKEN";
    if (signals.scriptIncompatible) return "SCRIPT_INCOMPATIBLE";
    if (signals.composerUnavailable) return "COMPOSER_UNAVAILABLE";
    if (signals.websocketError) return "WEBSOCKET_ERROR";
    if (signals.networkError) return "NETWORK_ERROR";
    if (signals.generationFailed) return "GENERATION_FAILED";
    return null;
  }

  // src/recovery/reload-resume.ts
  var RELOAD_RESUME_KEY = "chatgpt-autopilot.reload-resume.v1";
  function createReloadResumeMarker(input) {
    return {
      version: 1,
      path: input.path,
      requestedAt: input.requestedAt,
      sessionId: input.sessionIdentity.sessionId,
      rolloverIndex: input.sessionIdentity.rolloverIndex,
      reloadTimestamps: [...input.reloadTimestamps]
    };
  }
  function validateReloadResumeMarker(value, currentPath, now, maxAgeMs) {
    if (typeof value !== "object" || value === null) return null;
    const marker = value;
    if (marker.version !== 1) return null;
    if (typeof marker.path !== "string" || !marker.path.startsWith("/")) return null;
    if (marker.path !== currentPath) return null;
    if (typeof marker.requestedAt !== "number" || !Number.isFinite(marker.requestedAt)) return null;
    if (marker.requestedAt > now || now - marker.requestedAt > maxAgeMs) return null;
    if (typeof marker.sessionId !== "string" || marker.sessionId.trim().length === 0) return null;
    if (typeof marker.rolloverIndex !== "number" || !Number.isInteger(marker.rolloverIndex) || marker.rolloverIndex < 0) {
      return null;
    }
    if (!Array.isArray(marker.reloadTimestamps)) return null;
    const reloadTimestamps = [];
    for (const timestamp of marker.reloadTimestamps) {
      if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp > now)
        return null;
      reloadTimestamps.push(timestamp);
    }
    return {
      version: 1,
      path: marker.path,
      requestedAt: marker.requestedAt,
      sessionId: marker.sessionId,
      rolloverIndex: marker.rolloverIndex,
      reloadTimestamps
    };
  }

  // src/recovery/recovery-supervisor.ts
  var DEFAULT_RECOVERY_SETTINGS = Object.freeze({
    softStallTimeoutMs: 18e4,
    hardStallTimeoutMs: 6e5,
    onlineSettleMs: 1500,
    maxRegeneratesPerTurn: 1,
    maxReloadsPerWindow: 2,
    reloadWindowMs: 9e5,
    maxRecoveryFailures: 3
  });
  var TERMINAL_RESTRICTIONS = /* @__PURE__ */ new Set([
    "RATE_LIMIT",
    "USAGE_LIMIT",
    "LOGIN_REQUIRED",
    "VERIFICATION_REQUIRED"
  ]);
  var RECOVERABLE_ERRORS = /* @__PURE__ */ new Set([
    "GENERATION_FAILED",
    "NETWORK_ERROR",
    "WEBSOCKET_ERROR",
    "COMPOSER_UNAVAILABLE",
    "PAGE_BROKEN",
    "SCRIPT_INCOMPATIBLE"
  ]);
  var RecoverySupervisor = class {
    constructor(settings, actions) {
      this.settings = settings;
      this.actions = actions;
    }
    settings;
    actions;
    state = "NORMAL";
    online = true;
    generationActive = false;
    currentError = null;
    generationStartedAt = null;
    lastRelevantDomActivityAt = null;
    lastStateChangeAt = null;
    lastRecoveryAt = null;
    lastReloadAt = null;
    lastSuccessfulCompletionAt = null;
    regeneratesThisTurn = 0;
    recoveryFailures = 0;
    reloadTimestamps = [];
    onlineResumeAt = null;
    onGenerationStarted(now) {
      if (this.isTerminalState()) return;
      this.generationActive = true;
      this.currentError = null;
      this.generationStartedAt = now;
      this.lastRelevantDomActivityAt = now;
      this.setState("GENERATING", now);
    }
    onRelevantActivity(now) {
      this.lastRelevantDomActivityAt = now;
      if (this.state === "SUSPECT_STALL" && this.generationActive) {
        this.setState("GENERATING", now);
      }
    }
    onGenerationFinished(now) {
      this.generationActive = false;
      this.currentError = null;
      this.generationStartedAt = null;
      this.lastRelevantDomActivityAt = now;
      this.lastSuccessfulCompletionAt = now;
      this.regeneratesThisTurn = 0;
      this.recoveryFailures = 0;
      this.onlineResumeAt = null;
      if (!this.isTerminalState()) this.setState("NORMAL", now);
    }
    observeError(kind, now) {
      const previousError = this.currentError;
      this.currentError = kind;
      if (kind !== null && kind === previousError) return;
      if (kind === null) {
        if (this.state === "SAFETY_CHECK_WAIT" && this.generationActive) {
          this.setState("GENERATING", now);
        }
        return;
      }
      if (kind === "SAFETY_CHECK") {
        if (!this.isTerminalState()) this.setState("SAFETY_CHECK_WAIT", now);
        return;
      }
      if (TERMINAL_RESTRICTIONS.has(kind)) {
        this.pauseTerminal(`service restriction: ${kind.toLowerCase()}`, now);
        return;
      }
      if (kind === "CONVERSATION_LIMIT") {
        this.setState("CONVERSATION_EXHAUSTED", now);
        return;
      }
      if (RECOVERABLE_ERRORS.has(kind) || kind === "STALLED" || kind === "UNKNOWN") {
        this.recoveryFailures += 1;
        if (this.recoveryFailures >= this.settings.maxRecoveryFailures) {
          this.tripCircuitBreaker(now);
          return;
        }
        this.setState(kind === "STALLED" ? "STALLED" : "GENERATION_ERROR", now);
      }
    }
    setOnline(online, now) {
      if (this.online === online) return;
      this.online = online;
      if (!online) {
        this.onlineResumeAt = null;
        this.actions.pause("network offline");
        this.setState("PAUSED_NETWORK", now);
        return;
      }
      if (this.state === "PAUSED_NETWORK") {
        this.onlineResumeAt = now + this.settings.onlineSettleMs;
        this.setState("RECOVERY_WAIT", now);
      }
    }
    tick(now) {
      if (this.state === "FATAL" || this.state === "PAUSED") return;
      if (!this.online || this.state === "PAUSED_NETWORK") return;
      if (this.currentError === "SAFETY_CHECK" || this.state === "SAFETY_CHECK_WAIT") return;
      if (TERMINAL_RESTRICTIONS.has(this.currentError)) return;
      if (this.state === "RECOVERY_WAIT" && this.onlineResumeAt !== null) {
        if (now < this.onlineResumeAt) return;
        this.onlineResumeAt = null;
        this.setState(this.generationActive ? "GENERATING" : "NORMAL", now);
        return;
      }
      if (!this.generationActive) return;
      if (this.state !== "GENERATING" && this.state !== "SUSPECT_STALL") return;
      const lastActivity = this.lastRelevantDomActivityAt ?? this.generationStartedAt ?? now;
      const inactiveFor = Math.max(0, now - lastActivity);
      if (inactiveFor >= this.settings.hardStallTimeoutMs) {
        this.setState("STALLED", now);
        this.lastRecoveryAt = now;
        const stopped = this.actions.stopGeneration();
        if (stopped) this.setState("STOPPING", now);
        else this.recordRecoveryFailure(now);
        return;
      }
      if (inactiveFor >= this.settings.softStallTimeoutMs && this.state === "GENERATING") {
        this.setState("SUSPECT_STALL", now);
      }
    }
    requestRegenerate(now) {
      if (!this.canRecover()) return false;
      if (this.regeneratesThisTurn >= this.settings.maxRegeneratesPerTurn) return false;
      this.lastRecoveryAt = now;
      const started = this.actions.regenerate();
      if (!started) {
        this.recordRecoveryFailure(now);
        return false;
      }
      this.regeneratesThisTurn += 1;
      this.setState("REGENERATING", now);
      return true;
    }
    requestReload(now) {
      if (!this.canRecover()) return false;
      this.pruneReloadWindow(now);
      if (this.reloadTimestamps.length >= this.settings.maxReloadsPerWindow) {
        this.tripCircuitBreaker(now);
        return false;
      }
      this.reloadTimestamps.push(now);
      this.lastReloadAt = now;
      this.lastRecoveryAt = now;
      this.setState("RELOADING", now);
      this.actions.reload();
      return true;
    }
    requestRollover(now) {
      if (!this.canRecover() || this.state === "SAFETY_CHECK_WAIT") return false;
      this.lastRecoveryAt = now;
      this.setState("ROLLOVER_PREP", now);
      const started = this.actions.rollover();
      if (!started) {
        this.recordRecoveryFailure(now);
        return false;
      }
      this.setState("CREATING_NEW_CHAT", now);
      return true;
    }
    markRestoringAfterReload(now) {
      if (this.state === "FATAL" || this.state === "PAUSED") return;
      this.setState("RESTORING_AFTER_RELOAD", now);
    }
    restoreReloadHistory(timestamps, now) {
      this.reloadTimestamps.length = 0;
      for (const timestamp of timestamps) {
        if (Number.isFinite(timestamp) && timestamp <= now) this.reloadTimestamps.push(timestamp);
      }
      this.reloadTimestamps.sort((left, right) => left - right);
      this.pruneReloadWindow(now);
    }
    getReloadHistory(now) {
      this.pruneReloadWindow(now);
      return [...this.reloadTimestamps];
    }
    onAutomationDisabled(now) {
      this.generationActive = false;
      this.currentError = null;
      this.generationStartedAt = null;
      this.lastRelevantDomActivityAt = null;
      this.regeneratesThisTurn = 0;
      this.recoveryFailures = 0;
      this.onlineResumeAt = null;
      if (this.state !== "FATAL") this.setState("NORMAL", now);
    }
    resetRecovery(now = Date.now()) {
      this.regeneratesThisTurn = 0;
      this.recoveryFailures = 0;
      this.reloadTimestamps.length = 0;
      this.currentError = null;
      this.onlineResumeAt = null;
      this.setState(this.generationActive ? "GENERATING" : "NORMAL", now);
    }
    getSnapshot() {
      const now = this.lastStateChangeAt ?? 0;
      this.pruneReloadWindow(now);
      return {
        state: this.state,
        online: this.online,
        generationActive: this.generationActive,
        currentError: this.currentError,
        generationStartedAt: this.generationStartedAt,
        lastRelevantDomActivityAt: this.lastRelevantDomActivityAt,
        lastStateChangeAt: this.lastStateChangeAt,
        lastRecoveryAt: this.lastRecoveryAt,
        lastReloadAt: this.lastReloadAt,
        lastSuccessfulCompletionAt: this.lastSuccessfulCompletionAt,
        regeneratesThisTurn: this.regeneratesThisTurn,
        recoveryFailures: this.recoveryFailures,
        reloadsInWindow: this.reloadTimestamps.length
      };
    }
    recordRecoveryFailure(now) {
      this.recoveryFailures += 1;
      if (this.recoveryFailures >= this.settings.maxRecoveryFailures) {
        this.tripCircuitBreaker(now);
      }
    }
    tripCircuitBreaker(now) {
      if (this.state === "FATAL") return;
      this.actions.pause("recovery circuit breaker tripped");
      this.setState("FATAL", now);
    }
    pauseTerminal(reason, now) {
      if (this.state === "PAUSED" || this.state === "FATAL") return;
      this.setState("SERVICE_RESTRICTION", now);
      this.actions.pause(reason);
      this.setState("PAUSED", now);
    }
    canRecover() {
      return this.online && this.state !== "FATAL" && this.state !== "PAUSED" && this.state !== "PAUSED_NETWORK" && this.state !== "SAFETY_CHECK_WAIT" && !TERMINAL_RESTRICTIONS.has(this.currentError);
    }
    pruneReloadWindow(now) {
      const oldestAllowed = now - this.settings.reloadWindowMs;
      while (this.reloadTimestamps.length > 0 && this.reloadTimestamps[0] < oldestAllowed) {
        this.reloadTimestamps.shift();
      }
    }
    isTerminalState() {
      return this.state === "FATAL" || this.state === "PAUSED";
    }
    setState(state, now) {
      if (this.state === state) return;
      this.state = state;
      this.lastStateChangeAt = now;
    }
  };

  // src/settings/settings.ts
  var SETTINGS_KEY = "chatgpt-autopilot.settings.v1";
  var DEFAULT_CONTINUATION_PROMPT = "Продолжай выполнение текущей задачи с того места, где остановился. Не повторяй уже выполненное. Соблюдай исходные требования, ранее согласованную архитектуру и план. Продолжай выполнять реальные следующие шаги. Используй релевантные доступные engineering skills/workflows там, где они действительно требуются. Не описывай скрытую цепочку рассуждений — просто продолжай работу и показывай результаты.";
  var DEFAULT_SETTINGS = Object.freeze({
    continuationPrompt: DEFAULT_CONTINUATION_PROMPT,
    completionDebounceMs: 1500,
    postSubmitGuardMs: 2e3,
    watchdogMs: 5e3,
    softStallTimeoutMs: 18e4,
    hardStallTimeoutMs: 6e5,
    checkpointEvery: 10,
    sessionTurnLimit: 0,
    hotkey: "Alt+Shift+A",
    debug: false
  });
  function finiteNumber(value, fallback, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
  function integer(value, fallback, min, max) {
    return Math.trunc(finiteNumber(value, fallback, min, max));
  }
  function nonEmptyString(value, fallback, maxLength) {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > maxLength) return fallback;
    return value;
  }
  function normalizeSettings(value) {
    const source = typeof value === "object" && value !== null ? value : {};
    const softStallTimeoutMs = finiteNumber(
      source.softStallTimeoutMs,
      DEFAULT_SETTINGS.softStallTimeoutMs,
      3e4,
      18e5
    );
    const hardStallTimeoutMs = Math.max(
      softStallTimeoutMs,
      finiteNumber(source.hardStallTimeoutMs, DEFAULT_SETTINGS.hardStallTimeoutMs, 6e4, 36e5)
    );
    return {
      continuationPrompt: nonEmptyString(
        source.continuationPrompt,
        DEFAULT_SETTINGS.continuationPrompt,
        2e4
      ),
      completionDebounceMs: finiteNumber(
        source.completionDebounceMs,
        DEFAULT_SETTINGS.completionDebounceMs,
        250,
        1e4
      ),
      postSubmitGuardMs: finiteNumber(
        source.postSubmitGuardMs,
        DEFAULT_SETTINGS.postSubmitGuardMs,
        500,
        15e3
      ),
      watchdogMs: finiteNumber(source.watchdogMs, DEFAULT_SETTINGS.watchdogMs, 1e3, 3e4),
      softStallTimeoutMs,
      hardStallTimeoutMs,
      checkpointEvery: integer(source.checkpointEvery, DEFAULT_SETTINGS.checkpointEvery, 0, 1e3),
      sessionTurnLimit: integer(
        source.sessionTurnLimit,
        DEFAULT_SETTINGS.sessionTurnLimit,
        0,
        1e4
      ),
      hotkey: nonEmptyString(source.hotkey, DEFAULT_SETTINGS.hotkey, 100),
      debug: typeof source.debug === "boolean" ? source.debug : DEFAULT_SETTINGS.debug
    };
  }
  var SettingsStore = class {
    constructor(storage) {
      this.storage = storage;
    }
    storage;
    async load() {
      const stored = await Promise.resolve(this.storage.getValue(SETTINGS_KEY, {}));
      return normalizeSettings(stored);
    }
    async save(settings) {
      await Promise.resolve(this.storage.setValue(SETTINGS_KEY, normalizeSettings(settings)));
    }
    async reset() {
      await Promise.resolve(this.storage.setValue(SETTINGS_KEY, { ...DEFAULT_SETTINGS }));
    }
  };

  // src/ui/control.ts
  var ROOT_ID = "chatgpt-autopilot-control";
  var DEFAULT_HOTKEY = "Alt+Shift+A";
  function stateLabel(snapshot) {
    if (snapshot.safeMode) return "AUTO · safe mode";
    if (snapshot.recoveryState === "SAFETY_CHECK_WAIT") return "AUTO · safety check";
    switch (snapshot.state) {
      case "DISABLED":
        return "AUTO · off";
      case "ARMED":
        return "AUTO · armed";
      case "GENERATING":
        return "AUTO · generating";
      case "SETTLING":
        return "AUTO · settling";
      case "READY":
        return "AUTO · ready";
      case "SUBMITTING":
        return "AUTO · submitting";
      case "COOLDOWN":
        return "AUTO · cooldown";
      case "PAUSED":
        return "AUTO · paused";
      case "ERROR":
        return "AUTO · error";
    }
  }
  function technicalTooltip(snapshot) {
    return [
      `session ${snapshot.sessionId}`,
      `state ${snapshot.state}`,
      `recovery ${snapshot.recoveryState}`,
      `part ${snapshot.rolloverIndex}`,
      `turns ${snapshot.successfulTurns}`,
      `epoch ${snapshot.generationEpoch}`,
      snapshot.safeMode ? "safe mode enabled" : "safe mode disabled"
    ].join(" · ");
  }
  function parseHotkey(value) {
    const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    let key = "";
    let alt = false;
    let shift = false;
    let ctrl = false;
    let meta = false;
    for (const part of parts) {
      const normalized = part.toLowerCase();
      if (normalized === "alt") alt = true;
      else if (normalized === "shift") shift = true;
      else if (normalized === "ctrl" || normalized === "control") ctrl = true;
      else if (normalized === "meta" || normalized === "cmd" || normalized === "command") meta = true;
      else if (key.length === 0) key = part;
      else return null;
    }
    if (key.length === 0) return null;
    return { key: key.toLowerCase(), alt, shift, ctrl, meta };
  }
  function button(documentRef, action, label, title) {
    const element = documentRef.createElement("button");
    element.type = "button";
    element.dataset.action = action;
    element.textContent = label;
    element.title = title;
    return element;
  }
  var AutopilotControl = class {
    doc;
    callbacks;
    hotkey;
    root = null;
    statusButton = null;
    resetRecoveryButton = null;
    mounted = false;
    constructor(options) {
      this.doc = options.document ?? globalThis.document;
      this.callbacks = options.callbacks;
      this.hotkey = parseHotkey(options.hotkey ?? DEFAULT_HOTKEY);
    }
    mount() {
      if (this.mounted) return;
      const existing = this.doc.getElementById(ROOT_ID);
      if (existing) return;
      const root = this.doc.createElement("div");
      root.id = ROOT_ID;
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "ChatGPT Autopilot controls");
      root.setAttribute("data-chatgpt-autopilot-owned", "true");
      const style = this.doc.createElement("style");
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
      const statusButton = button(this.doc, "toggle", "AUTO · off", "Toggle Autopilot");
      statusButton.dataset.role = "status";
      const pauseButton = button(this.doc, "pause", "Pause", "Pause automation");
      const stopButton = button(this.doc, "stop", "Stop", "Emergency stop and disable automation");
      const safeButton = button(this.doc, "safe-mode", "Safe", "Enter Safe Mode");
      const resetButton = button(
        this.doc,
        "reset-recovery",
        "Reset",
        "Reset recovery circuit breaker"
      );
      const settingsButton = button(this.doc, "settings", "Settings", "Open Autopilot settings");
      statusButton.addEventListener("click", this.callbacks.onToggle);
      pauseButton.addEventListener("click", this.callbacks.onPause);
      stopButton.addEventListener("click", this.callbacks.onStop);
      safeButton.addEventListener("click", this.callbacks.onSafeMode);
      resetButton.addEventListener("click", this.callbacks.onResetRecovery);
      settingsButton.addEventListener("click", this.callbacks.onOpenSettings);
      root.append(
        style,
        statusButton,
        pauseButton,
        stopButton,
        safeButton,
        resetButton,
        settingsButton
      );
      this.doc.body.append(root);
      this.root = root;
      this.statusButton = statusButton;
      this.resetRecoveryButton = resetButton;
      this.doc.addEventListener("keydown", this.handleKeydown);
      this.mounted = true;
    }
    unmount() {
      if (!this.mounted) return;
      this.doc.removeEventListener("keydown", this.handleKeydown);
      this.root?.remove();
      this.root = null;
      this.statusButton = null;
      this.resetRecoveryButton = null;
      this.mounted = false;
    }
    render(snapshot) {
      if (!this.root || !this.statusButton || !this.resetRecoveryButton) return;
      this.statusButton.textContent = stateLabel(snapshot);
      this.statusButton.setAttribute(
        "aria-pressed",
        snapshot.enabled && !snapshot.safeMode ? "true" : "false"
      );
      this.resetRecoveryButton.disabled = snapshot.safeMode;
      this.root.dataset.state = snapshot.state.toLowerCase();
      this.root.dataset.safeMode = snapshot.safeMode ? "true" : "false";
      this.root.title = technicalTooltip(snapshot);
    }
    handleKeydown = (event) => {
      if (!this.hotkey || event.isComposing || event.repeat) return;
      const matches = event.key.toLowerCase() === this.hotkey.key && event.altKey === this.hotkey.alt && event.shiftKey === this.hotkey.shift && event.ctrlKey === this.hotkey.ctrl && event.metaKey === this.hotkey.meta;
      if (!matches) return;
      event.preventDefault();
      this.callbacks.onToggle();
    };
  };

  // src/main.ts
  var RELOAD_RESUME_MAX_AGE_MS = 6e4;
  function visible(element) {
    const view = element.ownerDocument.defaultView;
    let current = element;
    while (current) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      const style = view?.getComputedStyle(current);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
      current = current.parentElement;
    }
    return true;
  }
  function clickFirstVisible(doc, selectors) {
    for (const selector of selectors) {
      const candidate = doc.querySelector(selector);
      if (!candidate || !visible(candidate)) continue;
      candidate.click();
      return true;
    }
    return false;
  }
  function openSettingsDialog(doc, settings, store) {
    const existing = doc.getElementById("chatgpt-autopilot-settings");
    if (existing) {
      if (typeof existing.showModal === "function" && !existing.open) existing.showModal();
      else existing.open = true;
      return;
    }
    const dialog = doc.createElement("dialog");
    dialog.id = "chatgpt-autopilot-settings";
    dialog.setAttribute("data-chatgpt-autopilot-owned", "true");
    dialog.style.cssText = [
      "position:fixed",
      "z-index:2147483001",
      "max-width:min(92vw,620px)",
      "width:560px",
      "border:1px solid rgba(127,127,127,.32)",
      "border-radius:14px",
      "padding:18px",
      "background:#18181b",
      "color:#f4f4f5",
      "font:500 13px/1.45 ui-sans-serif,system-ui,sans-serif"
    ].join(";");
    const title = doc.createElement("h2");
    title.textContent = "Autopilot settings";
    title.style.cssText = "margin:0 0 14px;font-size:16px";
    const form = doc.createElement("form");
    form.method = "dialog";
    form.style.cssText = "display:grid;gap:12px";
    const promptLabel = doc.createElement("label");
    promptLabel.textContent = "Continuation prompt";
    promptLabel.style.cssText = "display:grid;gap:6px";
    const prompt = doc.createElement("textarea");
    prompt.name = "continuationPrompt";
    prompt.value = settings.continuationPrompt;
    prompt.rows = 6;
    prompt.style.cssText = "width:100%;box-sizing:border-box;border-radius:8px;padding:9px";
    promptLabel.append(prompt);
    const numberRow = doc.createElement("div");
    numberRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px";
    const checkpointLabel = doc.createElement("label");
    checkpointLabel.textContent = "Checkpoint every N turns (0 = off)";
    const checkpoint = doc.createElement("input");
    checkpoint.type = "number";
    checkpoint.min = "0";
    checkpoint.max = "1000";
    checkpoint.value = String(settings.checkpointEvery);
    checkpoint.style.cssText = "width:100%;box-sizing:border-box;margin-top:6px;padding:8px";
    checkpointLabel.append(checkpoint);
    const turnLimitLabel = doc.createElement("label");
    turnLimitLabel.textContent = "Session turn limit (0 = unlimited)";
    const turnLimit = doc.createElement("input");
    turnLimit.type = "number";
    turnLimit.min = "0";
    turnLimit.max = "10000";
    turnLimit.value = String(settings.sessionTurnLimit);
    turnLimit.style.cssText = "width:100%;box-sizing:border-box;margin-top:6px;padding:8px";
    turnLimitLabel.append(turnLimit);
    numberRow.append(checkpointLabel, turnLimitLabel);
    const note = doc.createElement("p");
    note.textContent = `Hotkey: ${settings.hotkey}. Timing/recovery defaults stay conservative in v0.1.0.`;
    note.style.cssText = "margin:0;color:#a1a1aa;font-size:12px";
    const actions = doc.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const save = doc.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    for (const item of [cancel, save]) {
      item.style.cssText = "border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 11px;background:#27272a;color:#f4f4f5";
    }
    actions.append(cancel, save);
    form.append(promptLabel, numberRow, note, actions);
    dialog.append(title, form);
    doc.body.append(dialog);
    cancel.addEventListener("click", () => dialog.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const nextPrompt = prompt.value.trim();
      if (nextPrompt.length > 0) settings.continuationPrompt = prompt.value;
      settings.checkpointEvery = Number.parseInt(checkpoint.value, 10) || 0;
      settings.sessionTurnLimit = Number.parseInt(turnLimit.value, 10) || 0;
      void store.save(settings);
      dialog.close();
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.open = true;
  }
  async function submitResumeAfterRollover(adapter, identity, isSafeMode) {
    const deadline = Date.now() + 5e3;
    const prompt = buildResumePrompt(identity);
    let inserted = false;
    while (Date.now() < deadline) {
      if (isSafeMode()) return false;
      if (!inserted && adapter.isComposerEmpty()) {
        inserted = adapter.insertComposerText(prompt);
      }
      if (inserted && !adapter.composerMatchesText(prompt)) return false;
      if (inserted && adapter.canSubmit()) return adapter.submitPrompt();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
  async function bootstrapAutopilot(options) {
    const doc = options.document;
    const getPath = options.getPath ?? (() => doc.defaultView?.location.pathname ?? "/");
    const reload = options.reload ?? (() => doc.defaultView?.location.reload());
    const now = options.now ?? (() => Date.now());
    const settingsStore = new SettingsStore(options.storage);
    const settings = await settingsStore.load();
    let reloadResume = null;
    try {
      const storedReloadResume = await Promise.resolve(
        options.storage.getValue(RELOAD_RESUME_KEY, null)
      );
      reloadResume = validateReloadResumeMarker(
        storedReloadResume,
        getPath(),
        now(),
        RELOAD_RESUME_MAX_AGE_MS
      );
      await Promise.resolve(options.storage.setValue(RELOAD_RESUME_KEY, null));
    } catch {
      reloadResume = null;
    }
    const sessionIdentity = reloadResume ? { sessionId: reloadResume.sessionId, rolloverIndex: reloadResume.rolloverIndex } : createSessionIdentity();
    const adapter = new ChatGptDomAdapter(doc);
    const navigator = new ProjectNavigator(sessionIdentity, { document: doc, getPath });
    let safeMode = false;
    let resumeAfterNetwork = false;
    let networkResumeTimer = null;
    let previousAutopilotState = "DISABLED";
    const autopilot = new Autopilot(adapter, settings, {
      getConversationKey: getPath,
      sessionIdentity,
      onStateChange: (snapshot) => {
        const timestamp = now();
        if (snapshot.state === "GENERATING" && previousAutopilotState !== "GENERATING") {
          recovery.onGenerationStarted(timestamp);
        }
        if (snapshot.state === "READY" && previousAutopilotState === "SETTLING") {
          recovery.onGenerationFinished(timestamp);
        }
        previousAutopilotState = snapshot.state;
        render();
      }
    });
    const recovery = new RecoverySupervisor(
      {
        ...DEFAULT_RECOVERY_SETTINGS,
        softStallTimeoutMs: settings.softStallTimeoutMs,
        hardStallTimeoutMs: settings.hardStallTimeoutMs
      },
      {
        stopGeneration: () => {
          if (safeMode) return false;
          const button2 = adapter.findStopButton();
          if (!button2) return false;
          button2.click();
          return true;
        },
        regenerate: () => {
          if (safeMode) return false;
          return clickFirstVisible(doc, [
            '[data-testid="regenerate-button"]',
            '[data-testid="retry-button"]'
          ]);
        },
        reload: () => {
          if (safeMode) return;
          const requestedAt = now();
          const marker = createReloadResumeMarker({
            path: getPath(),
            requestedAt,
            sessionIdentity,
            reloadTimestamps: recovery.getReloadHistory(requestedAt)
          });
          void Promise.resolve().then(() => options.storage.setValue(RELOAD_RESUME_KEY, marker)).then(() => {
            if (safeMode || !recoveryIsArmed()) {
              return Promise.resolve(options.storage.setValue(RELOAD_RESUME_KEY, null));
            }
            reload();
            return void 0;
          }).catch(() => {
            autopilot.pause("reload state persistence failed");
            render();
          });
        },
        rollover: () => {
          if (safeMode) return false;
          const context = navigator.captureContext();
          if (!navigator.canRollover(context)) return false;
          autopilot.disable();
          void navigator.createNewChatInSameProject().then(async (created) => {
            if (!created || safeMode) {
              recovery.observeError("SCRIPT_INCOMPATIBLE", now());
              render();
              return;
            }
            const submitted = await submitResumeAfterRollover(
              adapter,
              sessionIdentity,
              () => safeMode
            );
            if (!submitted || safeMode) {
              recovery.observeError("COMPOSER_UNAVAILABLE", now());
              render();
              return;
            }
            recovery.resetRecovery(now());
            autopilot.enable();
            render();
          });
          return true;
        },
        pause: (reason) => {
          if (autopilot.getSnapshot().state !== "PAUSED") autopilot.pause(reason);
        }
      }
    );
    if (reloadResume) recovery.restoreReloadHistory(reloadResume.reloadTimestamps, now());
    const render = () => {
      const auto = autopilot.getSnapshot();
      const recoverySnapshot = recovery.getSnapshot();
      control.render({
        state: auto.state,
        enabled: auto.enabled,
        safeMode,
        recoveryState: recoverySnapshot.state,
        sessionId: auto.sessionId,
        rolloverIndex: auto.rolloverIndex,
        successfulTurns: auto.successfulTurns,
        generationEpoch: auto.generationEpoch
      });
    };
    const recoveryIsArmed = () => {
      const snapshot = autopilot.getSnapshot();
      return snapshot.enabled && snapshot.state !== "DISABLED" && snapshot.state !== "PAUSED";
    };
    const inspectRecovery = (relevantActivity = false) => {
      if (!recoveryIsArmed()) return;
      const timestamp = now();
      if (relevantActivity) recovery.onRelevantActivity(timestamp);
      recovery.observeError(classifyUiError(adapter.getRecoveryUiSignals()), timestamp);
    };
    const advanceRecovery = () => {
      if (safeMode || !recoveryIsArmed()) return;
      const timestamp = now();
      recovery.tick(timestamp);
      const state = recovery.getSnapshot().state;
      if (state === "STOPPING" && !adapter.isGenerating()) {
        if (!recovery.requestRegenerate(timestamp)) recovery.requestReload(timestamp);
      } else if (state === "GENERATION_ERROR") {
        if (!recovery.requestRegenerate(timestamp)) recovery.requestReload(timestamp);
      } else if (state === "CONVERSATION_EXHAUSTED") {
        if (!recovery.requestRollover(timestamp)) autopilot.pause("project rollover unavailable");
      }
      render();
    };
    const cancelNetworkResume = () => {
      if (networkResumeTimer !== null) clearTimeout(networkResumeTimer);
      networkResumeTimer = null;
    };
    const clearReloadResumeMarker = () => {
      void Promise.resolve().then(() => options.storage.setValue(RELOAD_RESUME_KEY, null)).catch(() => void 0);
    };
    const stopByUser = () => {
      resumeAfterNetwork = false;
      cancelNetworkResume();
      autopilot.disable();
      recovery.onAutomationDisabled(now());
      clearReloadResumeMarker();
    };
    const control = new AutopilotControl({
      document: doc,
      hotkey: settings.hotkey,
      callbacks: {
        onToggle: () => {
          if (safeMode) return;
          if (autopilot.getSnapshot().enabled) {
            stopByUser();
          } else {
            autopilot.enable();
            inspectRecovery();
            advanceRecovery();
          }
          render();
        },
        onPause: () => {
          if (!safeMode) autopilot.pause("paused by user");
          render();
        },
        onStop: () => {
          stopByUser();
          render();
        },
        onSafeMode: () => {
          safeMode = !safeMode;
          stopByUser();
          render();
        },
        onResetRecovery: () => {
          if (!safeMode) recovery.resetRecovery(now());
          render();
        },
        onOpenSettings: () => openSettingsDialog(doc, settings, settingsStore)
      }
    });
    control.mount();
    autopilot.start();
    if (reloadResume) {
      autopilot.enable();
      inspectRecovery();
      advanceRecovery();
    } else {
      inspectRecovery();
    }
    render();
    const disconnectRecoveryObserver = adapter.observeRelevantActivity(() => {
      inspectRecovery(true);
      advanceRecovery();
    });
    const recoveryTimer = setInterval(advanceRecovery, settings.watchdogMs);
    const view = doc.defaultView;
    const handleOffline = () => {
      cancelNetworkResume();
      const snapshot = autopilot.getSnapshot();
      resumeAfterNetwork = resumeAfterNetwork || snapshot.enabled && snapshot.state !== "DISABLED" && snapshot.state !== "PAUSED" && snapshot.state !== "ERROR";
      recovery.setOnline(false, now());
      render();
    };
    const handleOnline = () => {
      recovery.setOnline(true, now());
      cancelNetworkResume();
      if (resumeAfterNetwork) {
        networkResumeTimer = setTimeout(() => {
          networkResumeTimer = null;
          const snapshot = autopilot.getSnapshot();
          if (!resumeAfterNetwork || safeMode || !snapshot.enabled || snapshot.state !== "PAUSED" || snapshot.pauseReason !== "network offline") {
            resumeAfterNetwork = false;
            return;
          }
          const timestamp = now();
          recovery.tick(timestamp);
          if (recovery.getSnapshot().state === "RECOVERY_WAIT") {
            render();
            return;
          }
          if (!adapter.isGenerating() && recovery.getSnapshot().generationActive) {
            recovery.onGenerationFinished(timestamp);
          }
          autopilot.disable();
          autopilot.enable();
          resumeAfterNetwork = false;
          inspectRecovery();
          advanceRecovery();
          render();
        }, DEFAULT_RECOVERY_SETTINGS.onlineSettleMs);
      }
      render();
    };
    view?.addEventListener("offline", handleOffline);
    view?.addEventListener("online", handleOnline);
    if (view && !view.navigator.onLine) handleOffline();
    options.registerMenuCommand("Autopilot: toggle", () => {
      if (safeMode) return;
      if (autopilot.getSnapshot().enabled) {
        stopByUser();
      } else {
        autopilot.enable();
        inspectRecovery();
        advanceRecovery();
      }
      render();
    });
    options.registerMenuCommand("Autopilot: emergency stop", () => {
      stopByUser();
      render();
    });
    options.registerMenuCommand("Autopilot: toggle Safe Mode", () => {
      safeMode = !safeMode;
      stopByUser();
      render();
    });
    options.registerMenuCommand(
      "Autopilot: settings",
      () => openSettingsDialog(doc, settings, settingsStore)
    );
    return {
      autopilot,
      recovery,
      navigator,
      control,
      dispose: () => {
        cancelNetworkResume();
        clearInterval(recoveryTimer);
        disconnectRecoveryObserver();
        view?.removeEventListener("offline", handleOffline);
        view?.removeEventListener("online", handleOnline);
        autopilot.stop();
        control.unmount();
        doc.getElementById("chatgpt-autopilot-settings")?.remove();
      }
    };
  }
  if (typeof document !== "undefined" && typeof GM_getValue === "function" && typeof GM_setValue === "function" && typeof GM_registerMenuCommand === "function") {
    void bootstrapAutopilot({
      document,
      storage: {
        getValue: (key, fallback) => GM_getValue(key, fallback),
        setValue: (key, value) => GM_setValue(key, value)
      },
      registerMenuCommand: GM_registerMenuCommand
    });
  }
})();
