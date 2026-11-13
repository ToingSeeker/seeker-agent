import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Autonomy, duration, parseHeartbeatInterval, parseLoopInterval, parseVerdict } from '../src/autonomy.mjs';

/** An Autonomy with a clock that can be moved and a judge that answers from a script. */
function make(verdicts = [], config = {}) {
  const clock = { t: 1_000_000 };
  const asked = [];
  const auto = new Autonomy({ now: () => clock.t, config, ask: async (system, user) => (asked.push({ system, user }), verdicts.shift() ?? '{"verdict":"continue","reason":"more to do"}') });
  return { auto, clock, asked };
}

test('intervals and verdicts are read strictly', () => {
  assert.equal(parseLoopInterval('5m'), 300);
  assert.equal(parseLoopInterval('1h30m'), 5400);
  assert.equal(parseLoopInterval('30s'), 30);
  assert.equal(parseLoopInterval('5'), null, 'a bare number is part of the prompt');
  assert.equal(parseLoopInterval('check'), null);
  assert.deepEqual(parseHeartbeatInterval('every 10m check the deploy'), { seconds: 600, rest: 'check the deploy' });
  assert.deepEqual(parseHeartbeatInterval('1.5 hours look'), { seconds: 5400, rest: 'look' });
  assert.equal(parseHeartbeatInterval('check the deploy'), null);
  assert.equal(duration(5400), '1h30m');
  assert.equal(duration(45), '45s');

  assert.deepEqual(parseVerdict('```json\n{"verdict": "DONE", "reason": "tests pass"}\n```'), { verdict: 'done', reason: 'tests pass', seconds: null });
  assert.deepEqual(parseVerdict('{"done": false, "reason": "x"}'), { verdict: 'continue', reason: 'x', seconds: null });
  assert.equal(parseVerdict('{"verdict":"wait","wait_for_seconds":120,"reason":"deploying"}').seconds, 120);
  assert.equal(parseVerdict('{"verdict":"maybe"}').verdict, 'continue');
  assert.equal(parseVerdict('I think it is done.'), null);
});

test('a goal is pursued turn after turn until the judge finds it done', async () => {
  const { auto, asked } = make(['{"verdict":"continue","reason":"tests still fail"}', '{"verdict":"done","reason":"all tests pass"}']);
  const set = auto.goalCommand('make the test suite pass');
  assert.equal(set.prompt, 'make the test suite pass');
  assert.match(set.lines[0], /Goal set \(up to 20 turns\)/);

  const first = await auto.afterTurn({ interrupted: false, response: 'Fixed two; one still fails.' });
  assert.match(first.lines[0], /^↻ Goal not reached yet \(1\/20\): tests still fail$/);
  assert.match(first.prompt, /^\[Carrying on with the goal you were given\]\nGoal: make the test suite pass\n\nTake the next definite step towards it\./);
  assert.match(asked[0].user, /^Goal:\nmake the test suite pass\n\nThe agent's latest reply:\nFixed two; one still fails\./);
  assert.match(asked[0].system, /^You decide whether an agent that works by itself has reached the goal/);

  const second = await auto.afterTurn({ interrupted: false, response: 'All 12 tests pass now.' });
  assert.deepEqual(second, { lines: ['✓ Goal achieved: all tests pass'] });
  assert.equal(auto.goal.status, 'done');
  assert.deepEqual(await auto.afterTurn({ interrupted: false, response: 'x' }), { lines: [] }, 'a finished goal is not judged again');
});

test('a goal pauses on interrupt, on a block, when the budget is used, and when the judge cannot be read', async () => {
  const stopped = make();
  stopped.auto.goalCommand('ship it');
  assert.match((await stopped.auto.afterTurn({ interrupted: true, response: 'x' })).lines[0], /paused — you interrupted/);
  assert.equal(stopped.asked.length, 0, 'an interrupted turn is not judged');
  assert.match(stopped.auto.goalCommand('resume').prompt, /Carrying on with the goal you were given/);
  assert.equal(stopped.auto.goal.status, 'active');

  const blocked = make(['{"verdict":"blocked","reason":"needs the production password"}']);
  blocked.auto.goalCommand('deploy');
  const out = await blocked.auto.afterTurn({ interrupted: false, response: 'I cannot continue without the password.' });
  assert.match(out.lines[0], /Goal judged unachievable — paused: needs the production password/);
  assert.equal(out.prompt, undefined);

  const budget = make([], { goalMaxTurns: 2 });
  budget.auto.goalCommand('never ends');
  assert.ok((await budget.auto.afterTurn({ interrupted: false, response: 'a' })).prompt);
  const last = await budget.auto.afterTurn({ interrupted: false, response: 'b' });
  assert.match(last.lines[0], /Goal paused — 2\/2 turns used/);
  assert.equal(budget.auto.goal.status, 'paused');

  const garbled = make(['no json', 'still none', 'nope']);
  garbled.auto.goalCommand('x y');
  assert.ok((await garbled.auto.afterTurn({ interrupted: false, response: 'a' })).prompt, 'an unreadable verdict counts as continue');
  await garbled.auto.afterTurn({ interrupted: false, response: 'a' });
  assert.match((await garbled.auto.afterTurn({ interrupted: false, response: 'a' })).lines[0], /could not be read 3 times/);

  const control = make();
  assert.match(control.auto.goalCommand('').lines[0], /No goal is set/);
  control.auto.goalCommand('-- pause the old server');
  assert.equal(control.auto.goal.text, 'pause the old server');
  assert.deepEqual(control.auto.goalCommand('clear').lines, ['Goal cleared.']);
  assert.equal(control.auto.goal, null);
});

test('a waiting goal is parked without using its budget and wakes when the time is up', async () => {
  const { auto, clock } = make(['{"verdict":"wait","wait_for_seconds":90,"reason":"the deploy is running"}']);
  auto.goalCommand('deploy and verify');
  const out = await auto.afterTurn({ interrupted: false, response: 'Deploy started; waiting.' });
  assert.match(out.lines[0], /Goal parked for 1m30s: the deploy is running/);
  assert.equal(auto.goal.turnsUsed, 0);
  assert.equal(auto.active, true);
  assert.equal(auto.hasDue(), false);
  clock.t += 91_000;
  assert.equal(auto.hasDue(), true);
  const due = auto.takeDue();
  assert.equal(due.kind, 'goal');
  assert.match(due.prompt, /Carrying on with the goal you were given/);
  assert.equal(auto.hasDue(), false);
});

test('a timed loop fires at once, then every interval counted from the end of each run', async () => {
  const { auto, clock } = make();
  assert.match(auto.loopCommand('every 5m check the deploy --times 2').lines[0], /^↻ Loop set \(every 5m, 2 times\): check the deploy$/);
  const first = auto.takeDue();
  assert.equal(first.kind, 'loop');
  assert.match(first.prompt, /^\[\/loop wakeup #1, every 5m\]\nRecurring task: check the deploy\n/);
  assert.equal(auto.hasDue(), false, 'not again while the first is being answered');
  clock.t += 120_000; // the answer took two minutes
  assert.deepEqual(await auto.completeLoopTick({ interrupted: false, response: 'still building' }), []);
  clock.t += 299_000;
  assert.equal(auto.hasDue(), false);
  clock.t += 2_000;
  assert.match(auto.takeDue().prompt, /wakeup #2/);
  assert.deepEqual(await auto.completeLoopTick({ interrupted: false, response: 'still building' }), ['✓ Loop finished after 2 ticks — ran 2 times.']);
  assert.equal(auto.loop, null);

  assert.match(auto.loopCommand('5s ping').lines[1], /shortest interval is 30s/);
  assert.equal(auto.loop.intervalSeconds, 30);
  auto.takeDue();
  assert.deepEqual(await auto.completeLoopTick({ interrupted: false, response: 'The site is up.\nLOOP_COMPLETE' }), ['✓ Loop finished after 1 tick — task complete.']);
});

test('a self-paced loop slows down while nothing changes; --until asks the judge; an interrupt pauses', async () => {
  const { auto, clock, asked } = make(['{"verdict":"continue","reason":"not yet"}', '{"verdict":"done","reason":"CI is green"}']);
  auto.loopCommand('watch the CI run --until the CI run is green');
  assert.equal(auto.loop.mode, 'self_paced');
  assert.equal(auto.loop.until, 'the CI run is green');
  const tick = auto.takeDue();
  assert.match(tick.prompt, /wakeup #1, self-paced\][\s\S]*Stop condition: the CI run is green/);
  await auto.completeLoopTick({ interrupted: false, response: 'CI is running, 3 of 9 jobs done at 10:41' });
  assert.equal(auto.loop.currentDelay, 60);
  clock.t += 61_000;
  auto.takeDue();
  assert.deepEqual(await auto.completeLoopTick({ interrupted: false, response: 'CI is green.' }), ['✓ Loop finished after 2 ticks — stop condition met: CI is green.']);
  assert.match(asked[0].user, /^Goal:\nthe CI run is green/);

  const quiet = make();
  quiet.auto.loopCommand('check the queue');
  for (const [reply, delay] of [['empty at 10:01', 60], ['empty at 10:02', 120], ['empty at 10:04', 240], ['3 jobs waiting', 60]]) {
    quiet.clock.t += 1_000_000;
    quiet.auto.takeDue();
    await quiet.auto.completeLoopTick({ interrupted: false, response: reply });
    assert.equal(quiet.auto.loop.currentDelay, delay, reply);
  }
  quiet.clock.t += 1_000_000;
  quiet.auto.takeDue();
  assert.match((await quiet.auto.completeLoopTick({ interrupted: true, response: '' }))[0], /Loop paused — you interrupted/);
  assert.equal(quiet.auto.hasDue(), false);
  assert.deepEqual(quiet.auto.loopCommand('resume').lines, ['↻ Loop resumed.']);
  assert.deepEqual(quiet.auto.loopCommand('stop').lines, ['Loop stopped.']);
});

test('a heartbeat fires when its interval has passed, once however long the session was busy; a loop waits for a goal', async () => {
  const { auto, clock } = make();
  assert.match(auto.heartbeatCommand('every 30s ping').lines[0], /shortest heartbeat is 60s/);
  assert.match(auto.heartbeatCommand('check the deploy').lines[0], /^\/heartbeat every <interval>/);
  assert.match(auto.heartbeatCommand('every 10m check the deploy').lines[0], /^♥ Heartbeat set \(every 10m\): check the deploy$/);
  assert.equal(auto.hasDue(), false);
  clock.t += 45 * 60_000; // busy for 45 minutes
  const beat = auto.takeDue();
  assert.equal(beat.kind, 'heartbeat');
  assert.match(beat.prompt, /^\[Heartbeat: a standing instruction that comes back every 10m\]\ncheck the deploy\n\nIf this instruction gives you nothing real/);
  assert.equal(auto.hasDue(), false, 'the missed beats collapsed into one');
  assert.equal(auto.heartbeat.fireCount, 1);
  auto.heartbeatCommand('stop');

  auto.goalCommand('finish the migration');
  auto.loopCommand('1m check logs');
  assert.equal(auto.hasDue(), false, 'the goal has the session; the loop waits');
  auto.goalCommand('pause');
  assert.equal(auto.takeDue().kind, 'loop');
});
