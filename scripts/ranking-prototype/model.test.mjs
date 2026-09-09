import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyze, audit, evaluate, fit, fromAppSnapshots, objective, sigmoid, validateRankings } from './model.mjs';

test('PL and BT gradients match finite differences, including long lists and extreme strengths', () => {
  for (const model of ['pl', 'bt']) for (const theta of [[0.7, -0.9, 0.2, 1.1], [100, -100, 0, -10]]) {
    const lists = [[0, 1, 2, 3], [2, 0], [3, 1, 0]], opts = { model, lambda: 0.3 };
    const analytic = objective(theta, lists, opts);
    theta.forEach((_, i) => {
      const plus = [...theta], minus = [...theta], h = 1e-5;
      plus[i] += h; minus[i] -= h;
      const numerical = (objective(plus, lists, opts).loss - objective(minus, lists, opts).loss) / (2 * h);
      assert.ok(Math.abs(numerical - analytic.gradient[i]) < 1e-6, `${model} gradient ${i}`);
    });
  }
});

test('two-restaurant fit reproduces analytical penalized likelihood optimum', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ userId: String(i), items: i < 75 ? ['A', 'B'] : ['B', 'A'] }));
  for (const model of ['pl', 'bt']) {
    const result = fit(rows, { model, lambda: 0.3, tolerance: 1e-7 });
    assert.ok(result.converged);
    const { A, B } = result.strengths;
    assert.ok(Math.abs(A + B) < 1e-8);
    assert.ok(Math.abs(100 * sigmoid(A - B) - 75 + 0.3 * A) < 2e-6);
  }
});

test('opponent strength distinguishes equal win rates in a connected network', () => {
  const schedule = [];
  function add(winner, loser, count) { for (let i = 0; i < count; i++) schedule.push({ userId: String(schedule.length), items: [winner, loser] }); }
  add('strong', 'weak', 80); add('weak', 'strong', 5);
  add('A', 'weak', 10); add('weak', 'A', 10);
  add('B', 'strong', 10); add('strong', 'B', 10);
  const result = fit(schedule);
  assert.ok(result.converged);
  assert.ok(result.strengths.B > result.strengths.A + 1);
});

test('disconnected islands never receive a shared benchmark score', () => {
  const rows = [{ userId: 'u', items: ['A', 'B'] }, { userId: 'v', items: ['X', 'Y'] }];
  const result = analyze(rows, { bootstrap: 25, referenceIds: ['A', 'X'] });
  assert.equal(result.coverage.components.length, 2);
  assert.ok(result.estimates.every(e => e.experimentalReferenceScore === null && e.rankInterval90 === null && !e.publishable));
});

test('audit identifies the only bridging user and lone observations', () => {
  const rows = [{ userId: 'left', items: ['A', 'B'] }, { userId: 'right', items: ['C', 'D'] }, { userId: 'bridge', items: ['B', 'C'] }, { userId: 'alone', items: ['E'] }];
  const coverage = audit(rows);
  assert.ok(coverage.fragmentationUsers.includes('bridge'));
  assert.equal(coverage.restaurantsDetail.find(r => r.id === 'E').comparisonUsers, 0);
  const result = analyze(rows, { bootstrap: 0 });
  assert.equal(result.estimates.find(e => e.id === 'E').componentRank, null);
});

test('directional separation is detected even inside an undirected connected component', () => {
  const rows = [{ userId: '1', items: ['A', 'B'] }, { userId: '2', items: ['B', 'A'] }, { userId: '3', items: ['B', 'C'] }, { userId: '4', items: ['C', 'D'] }, { userId: '5', items: ['D', 'C'] }];
  const result = analyze(rows, { bootstrap: 0 });
  assert.equal(result.coverage.components.length, 1);
  assert.equal(result.coverage.stronglyConnectedComponents.length, 2);
  assert.ok(result.estimates.every(e => e.reasons.some(r => r.includes('bidirectional'))));
});

test('adapter removes score-scale differences and reports source exclusions', () => {
  const make = (userId, scores) => ({ userId, ratings: scores.map((score, i) => ({ restaurantId: String(i), score, ratingMethod: 'h2h' })) });
  const result = fromAppSnapshots([make('generous', [9, 8, 7]), make('strict', [6, 4, 2])]);
  assert.deepEqual(result.rankings[0].items, result.rankings[1].items);
  const excluded = fromAppSnapshots([{ userId: 'u', ratings: [{ restaurantId: 'A', score: 5, ratingMethod: 'slider' }, { restaurantId: 'B', score: 6 }, { restaurantId: 'C', score: 7, ratingMethod: 'future' }] }]);
  assert.equal(excluded.report.excludedSlider, 1); assert.equal(excluded.report.excludedLegacy, 1); assert.equal(excluded.report.excludedUnknownMethod, 1);
  assert.deepEqual(excluded.rankings[0].items, []);
});

test('ties and duplicate current records never become arbitrary preferences', () => {
  const ratings = [{ restaurantId: 'A', score: 7, ratingMethod: 'h2h' }, { restaurantId: 'B', score: 7, ratingMethod: 'import' }];
  assert.deepEqual(fromAppSnapshots([{ userId: 'u', ratings }]).report.tiedUsers, ['u']);
  assert.throws(() => fromAppSnapshots([{ userId: 'u', ratings: [ratings[0], ratings[0]] }]), /Duplicate/);
  assert.throws(() => validateRankings([{ userId: 'u', items: [['A', 'B']] }]), /ties/);
  assert.throws(() => fit([{ userId: 'u', items: ['A', 'B'] }, { userId: 'u', items: ['A', 'B'] }]), /exactly one/);
});

test('per-user stage weighting bounds prolific user influence', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ userId: String(i), items: ['A', 'B'] }));
  rows.push({ userId: 'prolific', items: ['B', ...Array.from({ length: 100 }, (_, i) => `X${i}`), 'A'] });
  const result = fit(rows);
  assert.ok(result.converged); assert.ok(result.strengths.A > result.strengths.B);
});

test('bootstrap is reproducible, preserves input, and no interval is claimed with one user', () => {
  const rows = [{ userId: '1', items: ['A', 'B'] }, { userId: '2', items: ['B', 'A'] }, { userId: '3', items: ['A', 'B'] }];
  const before = JSON.stringify(rows), first = analyze(rows, { bootstrap: 25, seed: 7 });
  assert.deepEqual(first, analyze(rows, { bootstrap: 25, seed: 7 }));
  assert.equal(JSON.stringify(rows), before);
  assert.ok(first.estimates.every(e => e.rankInterval90 !== null));
  assert.ok(analyze(rows.slice(0, 1), { bootstrap: 25 }).estimates.every(e => e.rankInterval90 === null));
});

test('benchmark mapping is explicit, bounded and invariant to strength offset', () => {
  const rows = [{ userId: '1', items: ['A', 'B'] }, { userId: '2', items: ['B', 'A'] }];
  const result = analyze(rows, { bootstrap: 0, referenceIds: ['A', 'B'] });
  assert.ok(result.estimates.every(e => Math.abs(e.experimentalReferenceScore - 5.5) < 1e-8));
  assert.equal(sigmoid(3 - 1), sigmoid((3 + 100) - (1 + 100)));
  assert.throws(() => analyze(rows, { referenceIds: ['unknown'] }), /References/);
});

test('empty, one-sided and nonconverged fits are handled honestly', () => {
  assert.equal(analyze([], { bootstrap: 0 }).coverage.restaurants, 0);
  const rows = Array.from({ length: 12 }, (_, i) => ({ userId: String(i), items: ['A', 'B'] }));
  assert.ok(fit(rows).converged);
  assert.ok(audit(rows).restaurantsDetail.every(r => r.oneSided));
  const unfinished = analyze(rows, { maxIterations: 1, bootstrap: 0, referenceIds: ['A'] });
  assert.equal(unfinished.fit.converged, false);
  assert.ok(unfinished.estimates.every(e => e.experimentalReferenceScore === null));
  assert.throws(() => fit(rows, { lambda: 0 }), /Invalid/);
});

test('held-out evaluation skips unavailable and cross-component comparisons', () => {
  const rows = [{ userId: 'new', items: ['A', 'B', 'X', 'unseen'] }];
  const result = evaluate(rows, { A: 1, B: 0, X: 8 }, [['A', 'B'], ['X']]);
  assert.equal(result.accuracy, 1); assert.equal(result.pairs, 1); assert.equal(result.skippedPairs, 5);
});

test('CLI audits both minimized export formats and rejects ambiguous input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ranking-cli-'));
  try {
    const input = join(directory, 'input.json'), output = join(directory, 'output.json'), report = join(directory, 'report.md');
    const cli = new URL('./run.mjs', import.meta.url).pathname;
    for (const data of [
      { rankings: [{ userId: 'u', items: ['A', 'B'] }] },
      { snapshots: [{ userId: 'u', ratings: [{ restaurantId: 'A', score: 8, ratingMethod: 'h2h' }, { restaurantId: 'B', score: 7, ratingMethod: 'h2h' }] }] },
      { rankings: [] },
    ]) {
      writeFileSync(input, JSON.stringify(data));
      execFileSync(process.execPath, [cli, '--input', input, '--output', output, '--report', report, '--bootstrap', '0']);
      const parsed = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(parsed.analysis.researchOnly, true);
      assert.ok(readFileSync(report, 'utf8').includes('No scores are eligible for publication'));
    }
    writeFileSync(input, JSON.stringify({ rankings: [], snapshots: [] }));
    assert.throws(() => execFileSync(process.execPath, [cli, '--input', input], { stdio: 'pipe' }), /Provide exactly one/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
