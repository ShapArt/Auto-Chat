import type { SessionIdentity } from '../navigation/project-navigator';

export const RELOAD_RESUME_KEY = 'chatgpt-autopilot.reload-resume.v1';

export interface ReloadResumeMarker {
  version: 1;
  path: string;
  requestedAt: number;
  sessionId: string;
  rolloverIndex: number;
  reloadTimestamps: number[];
}

export function createReloadResumeMarker(input: {
  path: string;
  requestedAt: number;
  sessionIdentity: SessionIdentity;
  reloadTimestamps: readonly number[];
}): ReloadResumeMarker {
  return {
    version: 1,
    path: input.path,
    requestedAt: input.requestedAt,
    sessionId: input.sessionIdentity.sessionId,
    rolloverIndex: input.sessionIdentity.rolloverIndex,
    reloadTimestamps: [...input.reloadTimestamps],
  };
}

export function validateReloadResumeMarker(
  value: unknown,
  currentPath: string,
  now: number,
  maxAgeMs: number,
): ReloadResumeMarker | null {
  if (typeof value !== 'object' || value === null) return null;

  const marker = value as Record<string, unknown>;
  if (marker.version !== 1) return null;
  if (typeof marker.path !== 'string' || !marker.path.startsWith('/')) return null;
  if (marker.path !== currentPath) return null;
  if (typeof marker.requestedAt !== 'number' || !Number.isFinite(marker.requestedAt)) return null;
  if (marker.requestedAt > now || now - marker.requestedAt > maxAgeMs) return null;
  if (typeof marker.sessionId !== 'string' || marker.sessionId.trim().length === 0) return null;
  if (
    typeof marker.rolloverIndex !== 'number' ||
    !Number.isInteger(marker.rolloverIndex) ||
    marker.rolloverIndex < 0
  ) {
    return null;
  }
  if (!Array.isArray(marker.reloadTimestamps)) return null;

  const reloadTimestamps: number[] = [];
  for (const timestamp of marker.reloadTimestamps) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp > now)
      return null;
    reloadTimestamps.push(timestamp);
  }

  return {
    version: 1,
    path: marker.path,
    requestedAt: marker.requestedAt,
    sessionId: marker.sessionId,
    rolloverIndex: marker.rolloverIndex,
    reloadTimestamps,
  };
}
