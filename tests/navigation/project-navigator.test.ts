import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import {
  ProjectNavigator,
  buildContinuationPrompt,
  buildResumePrompt,
  createSessionIdentity,
  type SessionIdentity,
} from '../../src/navigation/project-navigator';

const PROJECT_KEY = 'g-p-synthetic-project';
const PROJECT_HOME = `/g/${PROJECT_KEY}/project`;
const PROJECT_CHAT = `/g/${PROJECT_KEY}/c/synthetic-conversation`;

function identity(overrides: Partial<SessionIdentity> = {}): SessionIdentity {
  return {
    sessionId: 'auto-20260905-abc123',
    rolloverIndex: 0,
    ...overrides,
  };
}

describe('ProjectNavigator', () => {
  let path: string;

  beforeEach(() => {
    path = PROJECT_CHAT;
    document.body.innerHTML = '';
  });

  it('captures project/conversation identity and detects ordinary navigation changes', () => {
    const navigator = new ProjectNavigator(identity(), {
      document,
      getPath: () => path,
    });

    const previous = navigator.captureContext();
    expect(previous).toEqual({
      projectKey: PROJECT_KEY,
      conversationKey: 'synthetic-conversation',
      path: PROJECT_CHAT,
    });

    path = '/c/synthetic-other';
    expect(navigator.contextChanged(previous)).toBe(true);
  });

  it('refuses rollover when same-project navigation cannot be proven from visible DOM', () => {
    const navigator = new ProjectNavigator(identity(), {
      document,
      getPath: () => path,
    });
    const previous = navigator.captureContext();

    document.body.innerHTML = '<a href="/">New chat</a>';
    expect(navigator.canRollover(previous)).toBe(false);

    document.body.innerHTML = `<a href="/g/g-p-other/project">Other project</a>`;
    expect(navigator.canRollover(previous)).toBe(false);
  });

  it('increments rollover index exactly once after confirmed same-project new-chat navigation', async () => {
    document.body.innerHTML = `<a id="project-home" href="${PROJECT_HOME}">Project</a>`;
    document.querySelector('#project-home')?.addEventListener('click', (event) => {
      event.preventDefault();
      path = PROJECT_HOME;
    });

    const session = identity();
    const navigator = new ProjectNavigator(session, {
      document,
      getPath: () => path,
      waitForNavigation: async (predicate) => predicate(path),
    });

    expect(await navigator.createNewChatInSameProject()).toBe(true);
    expect(session.rolloverIndex).toBe(1);

    expect(await navigator.createNewChatInSameProject()).toBe(false);
    expect(session.rolloverIndex).toBe(1);
  });
});

describe('rollover/checkpoint protocol', () => {
  it('creates technical session ids with the expected date prefix', () => {
    const session = createSessionIdentity(new Date('2026-09-05T10:11:12Z'), () => 'k9m2x7');

    expect(session.sessionId).toBe('auto-20260905-k9m2x7');
    expect(session.rolloverIndex).toBe(0);
  });

  it('builds a resume prompt from technical identity only', () => {
    const prompt = buildResumePrompt(identity({ rolloverIndex: 2 }));

    expect(prompt).toContain('[AUTOPILOT_RESUME]');
    expect(prompt).toContain('auto-20260905-abc123');
    expect(prompt).toContain('rolloverIndex: 2');
    expect(prompt).toContain('Project context');
    expect(prompt).toContain('AUTOPILOT_CHECKPOINT_V1');
    expect(prompt).not.toContain(PROJECT_CHAT);
    expect(prompt).not.toContain('conversation text');
  });

  it('requests checkpoints only on exact configured successful-turn boundaries', () => {
    const settings = { ...DEFAULT_SETTINGS, continuationPrompt: 'CONTINUE', checkpointEvery: 3 };
    const session = identity();

    expect(buildContinuationPrompt(settings, 0, session)).toBe('CONTINUE');
    expect(buildContinuationPrompt(settings, 2, session)).toBe('CONTINUE');
    expect(buildContinuationPrompt(settings, 3, session)).toContain('AUTOPILOT_CHECKPOINT_V1');
    expect(buildContinuationPrompt(settings, 4, session)).toBe('CONTINUE');
    expect(buildContinuationPrompt(settings, 6, session)).toContain('AUTOPILOT_CHECKPOINT_V1');
  });
});
