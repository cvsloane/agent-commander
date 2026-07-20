import { describe, expect, it } from 'vitest';
import { config } from './proxy';

describe('dashboard auth proxy matcher', () => {
  it('leaves installability and offline assets public for the browser and OS', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    for (const path of [
      '/sw.js',
      '/manifest.json',
      '/offline.html',
      '/icons/icon-192.png',
      '/sounds/notification.mp3',
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
    expect(matcher.test('/orchestrator')).toBe(true);
  });
});
