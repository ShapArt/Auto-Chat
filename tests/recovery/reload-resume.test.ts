import { describe, expect, it } from 'vitest';
import {
  createReloadResumeMarker,
  validateReloadResumeMarker,
} from '../../src/recovery/reload-resume';

describe('reload resume marker', () => {
  it('contains technical state only and validates for the same fresh path', () => {
    const marker = createReloadResumeMarker({
      path: '/g/g-p-synthetic/c/thread-a',
      requestedAt: 10_000,
      sessionIdentity: { sessionId: 'auto-20260905-test01', rolloverIndex: 2 },
      reloadTimestamps: [9_000, 10_000],
    });

    expect(Object.keys(marker).sort()).toEqual(
      ['path', 'reloadTimestamps', 'requestedAt', 'rolloverIndex', 'sessionId', 'version'].sort(),
    );
    expect(JSON.stringify(marker).toLowerCase()).not.toContain('prompt');
    expect(JSON.stringify(marker).toLowerCase()).not.toContain('conversationtext');
    expect(
      validateReloadResumeMarker(marker, '/g/g-p-synthetic/c/thread-a', 10_500, 60_000),
    ).toEqual(marker);
  });

  it('fails closed for stale, wrong-path, future, or malformed markers', () => {
    const marker = createReloadResumeMarker({
      path: '/c/thread-a',
      requestedAt: 10_000,
      sessionIdentity: { sessionId: 'auto-20260905-test02', rolloverIndex: 0 },
      reloadTimestamps: [10_000],
    });

    expect(validateReloadResumeMarker(marker, '/c/thread-b', 10_500, 60_000)).toBeNull();
    expect(validateReloadResumeMarker(marker, '/c/thread-a', 100_001, 60_000)).toBeNull();
    expect(validateReloadResumeMarker(marker, '/c/thread-a', 9_000, 60_000)).toBeNull();
    expect(
      validateReloadResumeMarker({ ...marker, sessionId: '' }, '/c/thread-a', 10_500, 60_000),
    ).toBeNull();
    expect(
      validateReloadResumeMarker(
        { ...marker, reloadTimestamps: ['bad'] },
        '/c/thread-a',
        10_500,
        60_000,
      ),
    ).toBeNull();
  });
});
