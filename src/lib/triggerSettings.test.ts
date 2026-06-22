import assert from 'node:assert/strict';
import { normalizeTriggerConfig } from './triggerSettings';

assert.deepEqual(normalizeTriggerConfig({
  enabled: true,
  mode: 'Advanced',
  threshold: 2,
  sensitivity: -1,
  cooldown: 400,
  bandStart: -20,
  bandEnd: 900,
  pulseStrength: 9,
}), {
  enabled: true,
  mode: 'Advanced',
  threshold: 1,
  sensitivity: 0,
  cooldown: 300,
  bandStart: 0,
  bandEnd: 256,
  pulseStrength: 5,
});

assert.deepEqual(normalizeTriggerConfig({
  mode: 'Auto Beat',
  freqIndex: 120.5,
}), {
  mode: 'Auto Beat',
  freqIndex: 120.5,
});

console.log('triggerSettings tests passed');
