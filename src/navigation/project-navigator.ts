import type { AutopilotSettings } from '../settings/settings';

export interface SessionIdentity {
  sessionId: string;
  rolloverIndex: number;
}

export interface ProjectContext {
  projectKey: string | null;
  conversationKey: string;
  path: string;
}

export interface ProjectNavigatorOptions {
  document?: Document;
  getPath?: () => string;
  waitForNavigation?: (predicate: (path: string) => boolean) => Promise<boolean>;
}

const PROJECT_ROUTE = /^\/g\/(g-p-[^/]+)\/(?:project|c\/([^/?#]+))(?:\/|$)/;
const ROOT_CONVERSATION_ROUTE = /^\/c\/([^/?#]+)(?:\/|$)/;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 5_000;
const DEFAULT_NAVIGATION_POLL_MS = 100;

function normalizePath(path: string): string {
  const value = path.trim();
  if (value.length === 0) return '/';

  try {
    return new URL(value, 'https://chatgpt.com').pathname;
  } catch {
    return value.split(/[?#]/, 1)[0] || '/';
  }
}

function parseContext(pathValue: string): ProjectContext {
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
    path,
  };
}

function projectHomePath(projectKey: string): string {
  return `/g/${projectKey}/project`;
}

function defaultRandomSuffix(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(6);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  }

  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

export function createSessionIdentity(
  now: Date = new Date(),
  randomSuffix: () => string = defaultRandomSuffix,
): SessionIdentity {
  const year = now.getUTCFullYear().toString().padStart(4, '0');
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = now.getUTCDate().toString().padStart(2, '0');
  const suffix = randomSuffix().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || '000000';

  return {
    sessionId: `auto-${year}${month}${day}-${suffix}`,
    rolloverIndex: 0,
  };
}

export function buildResumePrompt(identity: SessionIdentity): string {
  return [
    '[AUTOPILOT_RESUME]',
    `sessionId: ${identity.sessionId}`,
    `rolloverIndex: ${identity.rolloverIndex}`,
    'Continue the existing workflow using Project context and the latest AUTOPILOT_CHECKPOINT_V1 if available.',
    'Do not repeat completed work. Continue from the next concrete step and preserve the original requirements.',
  ].join('\n');
}

export function buildContinuationPrompt(
  settings: Pick<AutopilotSettings, 'continuationPrompt' | 'checkpointEvery'>,
  successfulTurns: number,
  identity: SessionIdentity,
): string {
  const checkpointDue =
    settings.checkpointEvery > 0 &&
    successfulTurns > 0 &&
    successfulTurns % settings.checkpointEvery === 0;

  if (!checkpointDue) return settings.continuationPrompt;

  return [
    settings.continuationPrompt,
    '',
    '[AUTOPILOT_CHECKPOINT_REQUEST]',
    `sessionId: ${identity.sessionId}`,
    `rolloverIndex: ${identity.rolloverIndex}`,
    'Before finishing this response, append a concise AUTOPILOT_CHECKPOINT_V1 with completed steps, current technical state, the next concrete step, and blockers if any.',
    'The userscript will not parse this checkpoint; it exists only for Project-context continuity.',
  ].join('\n');
}

export class ProjectNavigator {
  private readonly doc: Document;
  private readonly getPath: () => string;
  private readonly waitForNavigationOverride:
    | ((predicate: (path: string) => boolean) => Promise<boolean>)
    | undefined;

  constructor(
    private readonly identity: SessionIdentity,
    options: ProjectNavigatorOptions = {},
  ) {
    this.doc = options.document ?? globalThis.document;
    this.getPath = options.getPath ?? (() => globalThis.location?.pathname ?? '/');
    this.waitForNavigationOverride = options.waitForNavigation;
  }

  captureContext(): ProjectContext {
    return parseContext(this.getPath());
  }

  contextChanged(previous: ProjectContext): boolean {
    const current = this.captureContext();
    return (
      current.path !== previous.path ||
      current.projectKey !== previous.projectKey ||
      current.conversationKey !== previous.conversationKey
    );
  }

  canRollover(previous: ProjectContext): boolean {
    if (!previous.projectKey) return false;

    const current = this.captureContext();
    if (current.projectKey !== previous.projectKey) return false;

    const homePath = projectHomePath(previous.projectKey);
    if (current.path === homePath) return false;

    return this.findProjectHomeLink(previous.projectKey) !== null;
  }

  async createNewChatInSameProject(): Promise<boolean> {
    const previous = this.captureContext();
    if (!previous.projectKey || !this.canRollover(previous)) return false;

    const homePath = projectHomePath(previous.projectKey);
    const link = this.findProjectHomeLink(previous.projectKey);
    if (!link) return false;

    link.click();

    const confirmed = await this.waitForNavigation((path) => {
      const current = parseContext(path);
      return (
        current.projectKey === previous.projectKey &&
        current.path === homePath &&
        current.conversationKey !== previous.conversationKey
      );
    });

    if (!confirmed) return false;

    this.identity.rolloverIndex += 1;
    return true;
  }

  private findProjectHomeLink(projectKey: string): HTMLAnchorElement | null {
    const expectedPath = projectHomePath(projectKey);
    const anchors = this.doc.querySelectorAll<HTMLAnchorElement>('a[href]');

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href');
      if (!href) continue;

      try {
        const url = new URL(href, 'https://chatgpt.com');
        if (url.origin === 'https://chatgpt.com' && url.pathname === expectedPath) return anchor;
      } catch {
        // Ignore malformed visible hrefs and fail closed if no valid same-project link remains.
      }
    }

    return null;
  }

  private async waitForNavigation(predicate: (path: string) => boolean): Promise<boolean> {
    if (this.waitForNavigationOverride) return this.waitForNavigationOverride(predicate);

    const startedAt = Date.now();

    return new Promise((resolve) => {
      const check = (): void => {
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
}
