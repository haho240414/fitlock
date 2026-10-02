// Read-only summaries of existing day records. Calendar keys use the device's timezone.
import { addDays, daysBetween, dayKey, dayOf } from './rewards.js';

const count = (n) => Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
const repCount = (d) => Object.values(d.reps || {}).reduce((n, r) => n + count(r), 0);

export function weekStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
  return addDays(key, -weekday);
}

export function activityReport(state, { today = dayKey(), range = 'week' } = {}) {
  const start = weekStart(today);
  const elapsed = daysBetween(start, today) + 1;
  const keys = (first, n) => Array.from({ length: n }, (_, i) => addDays(first, i));
  const summary = (list) => list.reduce((out, key) => {
    const d = dayOf(state, key);
    const reps = repCount(d);
    out.reps += reps;
    out.unlocks += count(d.unlocks);
    out.days += reps > 0 ? 1 : 0;
    return out;
  }, { reps: 0, unlocks: 0, days: 0 });
  const week = summary(keys(start, elapsed));
  const previous = summary(keys(addDays(start, -7), elapsed));
  const chartKeys = range === 'fortnight' ? keys(addDays(today, -13), 14) : keys(start, 7);
  const exercises = {};
  const chart = chartKeys.map((key) => {
    const future = key > today;
    const d = future ? {} : dayOf(state, key);
    for (const [id, reps] of Object.entries(d.reps || {})) exercises[id] = (exercises[id] || 0) + count(reps);
    return { key, reps: repCount(d), today: key === today, future };
  });
  const exerciseList = Object.entries(exercises).filter(([, reps]) => reps > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, reps]) => ({ id, reps }));
  const total = exerciseList.reduce((n, e) => n + e.reps, 0);
  return {
    start, today, week, previous, delta: week.reps - previous.reps, chart,
    periodStart: chartKeys[0], exercises: exerciseList.map((e) => ({ ...e, pct: Math.round(e.reps / total * 100) })),
  };
}
