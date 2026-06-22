import assert from 'node:assert/strict';
import { createNeteaseCookieHeaders, NETEASE_COOKIE_HEADER, normalizeNeteaseCookie } from './neteaseCookie';

assert.equal(normalizeNeteaseCookie('  MUSIC_U=abc;\n__csrf=def  '), 'MUSIC_U=abc; __csrf=def');
assert.deepEqual(createNeteaseCookieHeaders(''), {});
assert.deepEqual(createNeteaseCookieHeaders(' MUSIC_U=abc; __csrf=def '), {
  [NETEASE_COOKIE_HEADER]: 'MUSIC_U=abc; __csrf=def',
});

console.log('neteaseCookie tests passed');
