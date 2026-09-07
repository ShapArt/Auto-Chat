// ==UserScript==
// @name         ChatGPT Autopilot Release Wizard
// @namespace    https://github.com/ShapArt/Auto-Chat
// @version      0.1.0-diag.6
// @description  Read-only guided release validation for Auto-Chat in Firefox + Tampermonkey.
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const ROOT_ID = 'chatgpt-autopilot-live-diagnostics';
  const OWNED_ATTR = 'data-chatgpt-autopilot-owned';
  const COMPOSER_SELECTOR = '#prompt-textarea';
  const SEND_SELECTOR = '#composer-submit-button, button[data-testid="send-button"]';
  const STOP_SELECTOR = 'button[data-testid="stop-button"]';
  const RELEASE_CHECK_ORDER = [
    'oneTurn',
    'manualProtection',
    'reconnect',
    'safetyHold',
    'sameProjectRollover',
  ];
  const CHECK_LABELS = {
    oneTurn: 'ONE TURN',
    manualProtection: 'MANUAL PROTECTION',
    reconnect: 'RECONNECT',
    safetyHold: 'SAFETY HOLD',
    sameProjectRollover: 'SAME-PROJECT ROLLOVER',
  };
  const CHECK_INSTRUCTIONS = {
    oneTurn: 'Run one harmless real turn and allow exactly one automatic continuation.',
    manualProtection:
      'Reset, start recording, enable Auto, then type a manual draft. Do not press Send; Auto must pause and preserve the draft.',
    reconnect:
      'Reset, start recording, enable Auto, briefly disconnect then reconnect the network, then wait for Auto to re-arm.',
    safetyHold:
      'Exercise only when ChatGPT naturally exposes a safety/extended-processing state. Auto must not Send while it is active; otherwise leave this check unexercised.',
    sameProjectRollover:
      'Exercise only when a same-Project rollover is naturally available. Never force a global New chat.',
  };

  const existing = document.getElementById(ROOT_ID);
  if (existing) existing.remove();

  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };

  const routeKind = (path) => {
    if (/^\/g\/g-p-[^/]+\/project\/?$/.test(path)) return 'project_home';
    if (/^\/g\/g-p-[^/]+\/(?:project\/)?c\/[^/]+/.test(path)) return 'project_chat';
    if (/^\/c\/[^/]+/.test(path)) return 'chat';
    return 'other';
  };
  const projectKey = (path) => path.match(/^\/g\/(g-p-[^/]+)/)?.[1] ?? null;

  const autoState = () => {
    const control = document.getElementById('chatgpt-autopilot-control');
    if (!(control instanceof HTMLElement)) return null;
    const button = [...control.querySelectorAll('button')].find((node) =>
      (node.textContent || '').trim().startsWith('AUTO'),
    );
    return button ? (button.textContent || '').trim().split('\n')[0] || null : null;
  };

  const structuralState = () => {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const send = document.querySelector(SEND_SELECTOR);
    const stop = document.querySelector(STOP_SELECTOR);
    const busy = [
      ...document.querySelectorAll('[data-message-author-role="assistant"][aria-busy="true"]'),
    ].filter(visible).length;
    const safety = [...document.querySelectorAll('[data-streaming-response-status]')].filter(
      visible,
    ).length;
    return {
      diagVersion: '0.1.0-diag.6',
      routeKind: routeKind(location.pathname),
      coreControlPresent: Boolean(document.getElementById('chatgpt-autopilot-control')),
      autoState: autoState(),
      composerPresent: composer instanceof HTMLElement,
      composerVisible: visible(composer),
      composerNonEmpty:
        composer instanceof HTMLElement ? Boolean((composer.textContent || '').trim()) : false,
      sendPresent: send instanceof HTMLElement,
      sendVisible: visible(send),
      generating: busy > 0 || visible(stop),
      safetyActive: safety > 0,
      online: navigator.onLine,
    };
  };

  let recording = false;
  let startedAt = null;
  let startedPerf = 0;
  let baselineProject = null;
  let privatePath = location.pathname;
  let lastState = null;
  let timeline = [];
  let sendClicks = 0;
  let sendClicksWhileSafety = 0;
  let generationStarts = 0;
  let generationEnds = 0;
  let trustedInputs = 0;
  let offlineEvents = 0;
  let onlineEvents = 0;
  let rolloverEvents = 0;
  let projectMismatchEvents = 0;
  let safetyStarts = 0;
  let safetyEnds = 0;

  const releaseResults = Object.fromEntries(
    RELEASE_CHECK_ORDER.map((name) => [name, 'not_exercised']),
  );

  const push = (type, detail = {}) => {
    if (!recording) return;
    timeline.push({
      tMs: Math.max(0, Math.round(performance.now() - startedPerf)),
      type,
      ...detail,
    });
    if (timeline.length > 300) timeline = timeline.slice(-300);
  };

  const clearRecordingCounters = () => {
    timeline = [];
    sendClicks = 0;
    sendClicksWhileSafety = 0;
    generationStarts = 0;
    generationEnds = 0;
    trustedInputs = 0;
    offlineEvents = 0;
    onlineEvents = 0;
    rolloverEvents = 0;
    projectMismatchEvents = 0;
    safetyStarts = 0;
    safetyEnds = 0;
  };

  const indexes = (type, after = -1, predicate = () => true) =>
    timeline.reduce((out, entry, index) => {
      if (index > after && entry.type === type && predicate(entry)) out.push(index);
      return out;
    }, []);

  const evaluateChecks = () => {
    const generationStart = indexes('generation_start')[0] ?? -1;
    const generationEnd = indexes('generation_end', generationStart)[0] ?? -1;
    const composerFilled =
      indexes('composer_state', generationEnd, (entry) => entry.nonEmpty === true)[0] ?? -1;
    const continuationSends = indexes('send_click', composerFilled);
    let oneTurn = 'not_exercised';
    if (generationStart >= 0 && generationEnd >= 0 && composerFilled >= 0) {
      if (continuationSends.length === 1) oneTurn = 'pass';
      else if (continuationSends.length > 1) oneTurn = 'fail';
    }

    const manualInput = indexes('composer_input', -1, (entry) => entry.trusted === true)[0] ?? -1;
    let manualProtection = 'not_exercised';
    if (manualInput >= 0) {
      const paused =
        indexes(
          'auto_state',
          manualInput,
          (entry) =>
            typeof entry.state === 'string' && entry.state.toLowerCase().includes('paused'),
        )[0] ?? -1;
      const laterSend = indexes('send_click', manualInput)[0] ?? -1;
      if (laterSend >= 0) manualProtection = 'fail';
      else if (paused >= 0) manualProtection = 'pass';
    }

    const offline = indexes('network_offline')[0] ?? -1;
    const online = indexes('network_online', offline)[0] ?? -1;
    let reconnect = 'not_exercised';
    if (offline >= 0 && online >= 0) {
      const armed =
        indexes(
          'auto_state',
          online,
          (entry) => typeof entry.state === 'string' && entry.state.toLowerCase().includes('armed'),
        )[0] ?? -1;
      if (armed >= 0) reconnect = 'pass';
    }

    let safetyHold = 'not_exercised';
    if (sendClicksWhileSafety > 0) safetyHold = 'fail';
    else if (safetyStarts > 0 && safetyEnds > 0) safetyHold = 'pass';

    let sameProjectRollover = 'not_exercised';
    if (projectMismatchEvents > 0) sameProjectRollover = 'fail';
    else if (rolloverEvents > 0) sameProjectRollover = 'pass';

    return { oneTurn, manualProtection, reconnect, safetyHold, sameProjectRollover };
  };

  const mergeResults = (checks) => {
    for (const name of RELEASE_CHECK_ORDER) {
      if (checks[name] === 'fail') releaseResults[name] = 'fail';
      else if (checks[name] === 'pass' && releaseResults[name] !== 'fail') {
        releaseResults[name] = 'pass';
      }
    }
  };

  const buildReleaseGate = (checks) => {
    mergeResults(checks);
    const failed = RELEASE_CHECK_ORDER.find((name) => releaseResults[name] === 'fail') ?? null;
    const currentCheck =
      failed ?? RELEASE_CHECK_ORDER.find((name) => releaseResults[name] !== 'pass') ?? null;
    return {
      status: failed ? 'fail' : currentCheck ? 'incomplete' : 'pass',
      currentCheck,
      currentLabel: currentCheck ? CHECK_LABELS[currentCheck] : 'COMPLETE',
      instruction: currentCheck
        ? CHECK_INSTRUCTIONS[currentCheck]
        : 'All five release checks passed. Copy the release-gate report.',
      results: { ...releaseResults },
    };
  };

  const counters = () => ({
    sendClicks,
    sendClicksWhileSafety,
    generationStarts,
    generationEnds,
    trustedInputs,
    offlineEvents,
    onlineEvents,
    rolloverEvents,
    projectMismatchEvents,
    safetyStarts,
    safetyEnds,
  });

  const buildReport = () => {
    const snapshot = structuralState();
    const checks = evaluateChecks();
    const releaseGate = buildReleaseGate(checks);
    return {
      diagVersion: '0.1.0-diag.6',
      recording,
      startedAt,
      snapshot,
      counters: counters(),
      checks,
      releaseGate,
      timeline: [...timeline],
    };
  };

  const buildReleaseGateReport = (report) => ({
    diagVersion: report.diagVersion,
    releaseGate: report.releaseGate,
    currentRecording: {
      startedAt: report.startedAt,
      checks: report.checks,
      counters: report.counters,
    },
    snapshot: report.snapshot,
  });

  const sample = () => {
    const next = structuralState();
    const nextPath = location.pathname;
    if (!recording) {
      lastState = next;
      privatePath = nextPath;
      return;
    }

    if (lastState) {
      if (!lastState.generating && next.generating) {
        generationStarts += 1;
        push('generation_start');
      } else if (lastState.generating && !next.generating) {
        generationEnds += 1;
        push('generation_end');
      }
      if (lastState.composerNonEmpty !== next.composerNonEmpty) {
        push('composer_state', { nonEmpty: next.composerNonEmpty });
      }
      if (lastState.autoState !== next.autoState) push('auto_state', { state: next.autoState });
      if (!lastState.safetyActive && next.safetyActive) {
        safetyStarts += 1;
        push('safety_start');
      } else if (lastState.safetyActive && !next.safetyActive) {
        safetyEnds += 1;
        push('safety_end');
      }
    }

    if (nextPath !== privatePath) {
      const before = routeKind(privatePath);
      const now = routeKind(nextPath);
      const currentProject = projectKey(nextPath);
      if (before === 'project_chat' && now === 'project_chat') {
        if (baselineProject && currentProject === baselineProject) {
          rolloverEvents += 1;
          push('project_rollover', { routeKind: now, sameProject: true });
        } else if (baselineProject && currentProject && currentProject !== baselineProject) {
          projectMismatchEvents += 1;
          push('project_mismatch', { routeKind: now, sameProject: false });
        }
      }
      privatePath = nextPath;
    }
    lastState = next;
  };

  const startRecording = () => {
    clearRecordingCounters();
    recording = true;
    startedAt = new Date().toISOString();
    startedPerf = performance.now();
    baselineProject = projectKey(location.pathname);
    privatePath = location.pathname;
    lastState = structuralState();
    push('live_gate_start', { routeKind: lastState.routeKind, autoState: lastState.autoState });
  };

  const resetRecording = () => {
    recording = false;
    startedAt = null;
    startedPerf = 0;
    baselineProject = null;
    privatePath = location.pathname;
    clearRecordingCounters();
    lastState = structuralState();
  };

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute(OWNED_ATTR, 'true');
  root.style.cssText =
    'position:fixed;right:16px;top:16px;z-index:2147483647;width:min(94vw,520px);max-height:78vh;overflow:auto;padding:12px;border:2px solid #66b3ff;border-radius:12px;background:#151515;color:#f5f5f5;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;box-shadow:0 10px 35px rgba(0,0,0,.4)';

  const title = document.createElement('div');
  title.textContent = 'AUTO-CHAT RELEASE WIZARD · DIAG.6 · READ ONLY';
  title.style.cssText = 'font-weight:800;margin-bottom:8px;color:#9fd0ff';

  const hint = document.createElement('div');
  hint.textContent =
    'Только структурные события. Не читает текст сообщений, cookies, storage, URL/ID чатов и не делает сетевых запросов.';
  hint.style.cssText = 'margin-bottom:8px;white-space:normal';

  const releaseBanner = document.createElement('div');
  releaseBanner.setAttribute('data-release-gate-banner', 'true');
  releaseBanner.style.cssText =
    'margin:8px 0 4px;padding:10px;border:2px solid #66b3ff;border-radius:9px;font-size:14px;font-weight:900;white-space:normal';

  const nextStep = document.createElement('div');
  nextStep.setAttribute('data-release-gate-next-step', 'true');
  nextStep.style.cssText =
    'margin:0 0 8px;padding:8px 10px;border:1px solid #4f6f8f;border-radius:8px;white-space:normal';

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Full structural report';
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;word-break:break-word';
  details.append(summary, pre);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap';
  const button = (label, handler) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.style.cssText =
      'padding:6px 9px;border:1px solid #666;border-radius:7px;background:#262626;color:#fff;cursor:pointer';
    node.addEventListener('click', handler);
    return node;
  };

  let lastReport;
  const render = () => {
    lastReport = buildReport();
    releaseBanner.textContent = `RELEASE GATE: ${lastReport.releaseGate.status.toUpperCase()} · ${lastReport.releaseGate.currentLabel}`;
    nextStep.textContent = `NEXT: ${lastReport.releaseGate.instruction}`;
    pre.textContent = JSON.stringify(lastReport, null, 2);
  };

  const start = button('Start live gate', () => {
    startRecording();
    render();
  });
  const reset = button('Reset', () => {
    resetRecording();
    render();
  });
  const copyRelease = button('Copy release-gate report', async () => {
    sample();
    lastReport = buildReport();
    const text = JSON.stringify(buildReleaseGateReport(lastReport), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copyRelease.textContent = 'Copied release-gate report';
      setTimeout(() => (copyRelease.textContent = 'Copy release-gate report'), 1200);
    } catch {
      console.log('[AUTO-CHAT RELEASE GATE]', text);
    }
  });
  let closed = false;
  const close = button('Close', () => {
    closed = true;
    observer.disconnect();
    root.remove();
  });

  controls.append(start, reset, copyRelease, close);
  root.append(title, hint, releaseBanner, nextStep, details, controls);
  document.body.append(root);

  const observer = new MutationObserver((mutations) => {
    if (mutations.every((mutation) => root.contains(mutation.target))) return;
    sample();
    render();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-busy', 'aria-disabled', 'aria-hidden', 'disabled'],
  });

  document.addEventListener(
    'click',
    (event) => {
      if (!recording) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const send = target.closest(SEND_SELECTOR);
      if (!(send instanceof HTMLElement) || !visible(send)) return;
      sendClicks += 1;
      if (lastState?.safetyActive) sendClicksWhileSafety += 1;
      push('send_click', { whileSafety: Boolean(lastState?.safetyActive) });
      sample();
      render();
    },
    true,
  );

  document.addEventListener(
    'input',
    (event) => {
      if (!recording) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(COMPOSER_SELECTOR)) return;
      if (event.isTrusted) trustedInputs += 1;
      push('composer_input', {
        trusted: Boolean(event.isTrusted),
        nonEmpty: Boolean((target.textContent || '').trim()),
      });
      sample();
      render();
    },
    true,
  );

  window.addEventListener('offline', () => {
    if (recording) {
      offlineEvents += 1;
      push('network_offline');
    }
    sample();
    render();
  });
  window.addEventListener('online', () => {
    if (recording) {
      onlineEvents += 1;
      push('network_online');
    }
    sample();
    render();
  });
  window.addEventListener('popstate', () => {
    sample();
    render();
  });

  lastState = structuralState();
  render();
  const timer = setInterval(() => {
    if (closed || !document.contains(root)) {
      clearInterval(timer);
      observer.disconnect();
      return;
    }
    sample();
    render();
  }, 500);

  try {
    GM_registerMenuCommand('Auto-Chat release wizard: print sanitized report', () => {
      sample();
      console.log('[AUTO-CHAT RELEASE GATE]', buildReleaseGateReport(buildReport()));
    });
  } catch (error) {
    console.error('[AUTO-CHAT RELEASE GATE] menu command unavailable', error);
  }
})();
