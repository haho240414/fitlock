import test from 'node:test';
import assert from 'node:assert/strict';
import { activityReport, weekStart } from '../../app/js/activity.js';
import { emptyState } from '../../app/js/rewards.js';

test('Monday-based weeks cross month, year and DST boundaries', () => {
  assert.equal(weekStart('2026-10-04'), '2026-09-28');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(weekStart('2026-03-08'), '2026-03-02');
  assert.equal(weekStart('2026-03-09'), '2026-03-09');
});
test('comparison uses the same elapsed weekdays, excluding last week’s weekend and future records', () => {
  const s = emptyState();
  s.days = {
    '2026-09-21': { reps: { squat: 20 }, unlocks: 2 },
    '2026-09-26': { reps: { squat: 900 } },
    '2026-09-28': { reps: { squat: 30 }, unlocks: 3 },
    '2026-10-02': { reps: { lunge: 10 }, unlocks: 1 },
    '2026-10-03': { reps: { squat: 500 } },
  };
  const r = activityReport(s, { today: '2026-10-02' });
  assert.deepEqual(r.week, { reps: 40, unlocks: 4, days: 2 });
  assert.equal(r.previous.reps, 20);
  assert.equal(r.delta, 20);
  assert.equal(r.chart.at(-2).reps, 0);
  assert.equal(r.chart.at(-2).future, true);
});
test('exercise totals respect the selected period and are sorted by amount', () => {
  const s = emptyState();
  s.days = {
    '2026-09-20': { reps: { squat: 999 } },
    '2026-09-22': { reps: { lunge: 30 } },
    '2026-10-02': { reps: { squat: 30, lunge: 10 } },
  };
  assert.deepEqual(activityReport(s, { today: '2026-10-02' }).exercises,
    [{ id: 'squat', reps: 30, pct: 75 }, { id: 'lunge', reps: 10, pct: 25 }]);
  const r = activityReport(s, { today: '2026-10-02', range: 'fortnight' });
  assert.equal(r.chart.length, 14);
  assert.equal(r.periodStart, '2026-09-19');
  assert.equal(r.exercises[0].reps, 1029);
});
test('empty and invalid values do not invent activity, NaN or percentages', () => {
  const s = emptyState();
  s.days['2026-10-02'] = { reps: { squat: -10, lunge: NaN, pushup: '20' }, unlocks: -1 };
  const r = activityReport(s, { today: '2026-10-02' });
  assert.deepEqual(r.week, { reps: 0, days: 0, unlocks: 0 });
  assert.deepEqual(r.exercises, []);
  assert.equal(r.delta, 0);
  assert.ok(r.chart.every((d) => d.reps === 0));
});
