import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { localToday, observeSystemDate } from '../daily-data.js';

test('system date follows the computer timezone rather than the UTC calendar date', () => {
  for (const [zone, expected] of [['Asia/Shanghai', '2026-11-25'], ['UTC', '2026-11-24'], ['America/Los_Angeles', '2026-11-24']]) {
    const code = `import {localToday} from ${JSON.stringify(new URL('../daily-data.js', import.meta.url).href)}; process.stdout.write(localToday(new Date('2026-11-24T16:00:00Z')));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {env: {...process.env, TZ: zone}, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test('a page kept open across local midnight advances to the next day', () => {
  let clock = new Date(2026, 10, 24, 23, 59, 59, 900), tick, delay;
  const dates = [];
  const stop = observeSystemDate(value => dates.push(value), {
    now: () => clock, focusTarget: new EventTarget(), visibilityTarget: new EventTarget(),
    setTimer: (callback, milliseconds) => {tick = callback; delay = milliseconds; return 1;}, clearTimer() {},
  });
  assert.equal(dates.at(-1), '2026-11-24');
  assert.ok(delay > 0 && delay < 1000);
  clock = new Date(2026, 10, 25, 0, 0, 0, 10);
  tick();
  assert.equal(dates.at(-1), '2026-11-25');
  assert.equal(localToday(clock), dates.at(-1));
  stop();
});

test('wake, focus, and clock changes refresh the date; unmounted pages stop listening', () => {
  let clock = new Date(2026, 10, 25), tick;
  const focusTarget = new EventTarget(), visibilityTarget = new EventTarget(), dates = [];
  const stop = observeSystemDate(value => dates.push(value), {
    now: () => clock, focusTarget, visibilityTarget,
    setTimer: callback => {tick = callback; return 1;}, clearTimer() {},
  });
  clock = new Date(2026, 10, 27);
  focusTarget.dispatchEvent(new Event('focus'));
  assert.equal(dates.at(-1), '2026-11-27');
  clock = new Date(2026, 10, 28);
  visibilityTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dates.at(-1), '2026-11-28');
  clock = new Date(2026, 10, 24);
  tick();
  assert.equal(dates.at(-1), '2026-11-24');
  stop();
  const count = dates.length;
  tick(); focusTarget.dispatchEvent(new Event('focus')); visibilityTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dates.length, count);
});
