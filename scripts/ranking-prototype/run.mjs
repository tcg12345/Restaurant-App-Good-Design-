import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { analyze, audit, evaluate, fit, fromAppSnapshots, random } from './model.mjs';

const { values } = parseArgs({ options: {
  input: { type: 'string' }, output: { type: 'string' }, report: { type: 'string' },
  bootstrap: { type: 'string', default: '80' }, seed: { type: 'string', default: '20260909' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('node scripts/ranking-prototype/run.mjs [--input minimal-export.json] [--output /tmp/results.json] [--report /tmp/report.md] [--bootstrap 80] [--seed 20260909]\nWithout --input, runs synthetic experiments. Writes files only when explicitly requested.');
  process.exit(0);
}
const seed = Number(values.seed), bootstrap = Number(values.bootstrap);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(bootstrap) || bootstrap < 0) throw new Error('seed must be uint32; bootstrap must be a nonnegative integer');

function synthetic({ seed, users = 240, selective = false, polarized = false, disconnected = false, sparse = false }) {
  const rng = random(seed);
  const ids = Array.from({ length: 18 }, (_, i) => `restaurant-${String(i + 1).padStart(2, '0')}`);
  const truth = Object.fromEntries(ids.map((id, i) => [id, -2.4 + 4.8 * i / (ids.length - 1)]));
  const rankings = [], snapshots = [];
  for (let u = 0; u < (sparse ? 3 : users); u++) {
    const upper = u % 2 === 0;
    const pool = disconnected ? ids.slice(upper ? 9 : 0, upper ? 18 : 9)
      : selective ? ids.slice(upper ? 6 : 0, upper ? 18 : 12) : ids;
    const chosen = [...pool];
    for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
    const userId = `user-${u}`;
    const items = chosen.slice(0, sparse ? 3 : 6 + u % 4).map(id => {
      const cuisinePreference = polarized ? (upper ? 1 : -1) * (ids.indexOf(id) % 2 ? 3 : -3) : 0;
      // Independent Gumbel utilities give exactly PL-generated strict lists.
      const utility = truth[id] + cuisinePreference - Math.log(-Math.log(Math.max(1e-12, rng())));
      return { id, utility };
    }).sort((a, b) => b.utility - a.utility);
    rankings.push({ userId, items: items.map(r => r.id) });
    // Every user's score transform is strictly increasing (no clipping).
    // Selective scenario correlates generosity with weak-only selections.
    const bias = selective ? (upper ? -2 : 2) : 3 * (rng() - 0.5);
    const scale = 0.7 + rng() * 0.6;
    snapshots.push({ userId, ratings: items.map(r => ({ restaurantId: r.id, ratingMethod: 'h2h', score: 1 + 9 / (1 + Math.exp(-(r.utility * scale + bias) / 2)) })) });
  }
  return { rankings, snapshots, truth };
}

function meanScores(snapshots) {
  const acc = new Map();
  for (const { ratings } of snapshots) for (const { restaurantId: id, score } of ratings) {
    if (!acc.has(id)) acc.set(id, []);
    acc.get(id).push(score);
  }
  return Object.fromEntries([...acc].map(([id, scores]) => [id, scores.reduce((a, b) => a + b, 0) / scores.length]));
}

function rankAgreement(strengths, truth, groups) {
  let correct = 0, total = 0;
  for (const group of groups) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j], product = (strengths[a] - strengths[b]) * (truth[a] - truth[b]);
    if (!Number.isFinite(product)) continue;
    correct += Math.abs(product) < 1e-8 ? 0.5 : Number(product > 0); total++;
  }
  return total ? correct / total : null;
}

const percent = x => x == null ? 'n/a' : `${(100 * x).toFixed(1)}%`;
let result, markdown;
if (values.input) {
  const input = JSON.parse(await readFile(values.input, 'utf8'));
  if (!!input.rankings === !!input.snapshots) throw new Error('Provide exactly one of rankings or snapshots');
  const adapted = input.snapshots ? fromAppSnapshots(input.snapshots) : { rankings: input.rankings, report: null };
  result = { source: 'local export; not live data', adapter: adapted.report, analysis: analyze(adapted.rankings, { bootstrap, seed, referenceIds: input.referenceIds ?? [] }) };
  const c = result.analysis.coverage;
  markdown = `# Offline ranking audit\n\nResearch only. No scores are eligible for publication.\n\n${c.users} users; ${c.informativeUsers} informative users; ${c.restaurants} restaurants; ${c.components.length} disconnected components; ${c.fragmentationUsers.length} users whose removal fragments coverage.\n\nOptimizer converged: ${result.analysis.fit.converged}. See JSON for per-restaurant uncertainty and exclusions. No global rank exists across disconnected components.\n`;
} else {
  const scenarios = [
    ['Connected, mixed rating scales', {}],
    ['Strong/weak selections, correlated generosity', { selective: true }],
    ['Disconnected restaurant communities', { disconnected: true }],
    ['Opposing cuisine preferences', { polarized: true }],
    ['Sparse startup', { sparse: true }],
  ];
  result = { source: 'synthetic only; no real users or database queries', seed, bootstrap, scenarios: [] };
  for (const [name, options] of scenarios) {
    const data = synthetic({ seed: seed + result.scenarios.length, ...options });
    // Keep both alternating taste/selection groups represented in both splits.
    const training = data.rankings.filter((_, i) => i % 5 !== 0);
    const heldout = data.rankings.filter((_, i) => i % 5 === 0);
    const trainingSnapshots = data.snapshots.filter((_, i) => i % 5 !== 0);
    const references = [...new Set(training.flatMap(r => r.items))].sort();
    const analysis = analyze(training, { bootstrap, seed, referenceIds: references });
    const bt = fit(training, { model: 'bt' });
    const mean = meanScores(trainingSnapshots);
    const groups = analysis.coverage.components;
    const plEval = evaluate(heldout, analysis.fit.strengths, groups);
    const btEval = evaluate(heldout, bt.strengths, groups);
    const meanEval = evaluate(heldout, mean, groups);
    // Score magnitudes are not calibrated log odds; report only ordering accuracy.
    delete meanEval.pairLogLoss;
    const adapter = fromAppSnapshots(data.snapshots);
    const scaleInvariant = JSON.stringify(adapter.rankings.map(r => r.items)) === JSON.stringify(data.rankings.map(r => r.items));
    const sensitivity = [0.1, 1].map(lambda => {
      const alternative = fit(training, { lambda });
      return { lambda, converged: alternative.converged, truthAgreement: options.polarized ? null : rankAgreement(alternative.strengths, data.truth, groups), evaluation: evaluate(heldout, alternative.strengths, groups) };
    });
    result.scenarios.push({ name, trainingUsers: training.length, heldoutUsers: heldout.length, scaleInvariant, analysis, btFit: bt, evaluation: { pl: plEval, bt: btEval, meanScore: meanEval }, truthAgreement: options.polarized ? null : { pl: rankAgreement(analysis.fit.strengths, data.truth, groups), meanScore: rankAgreement(mean, data.truth, groups) }, sensitivity });
    console.log(`${name}: ${analysis.coverage.components.length} components; held-out accuracy PL ${percent(plEval.accuracy)}, BT ${percent(btEval.accuracy)}, mean ${percent(meanEval.accuracy)}; converged ${analysis.fit.converged && bt.converged}`);
  }
  // Controlled graph example: only one user connects two otherwise separate groups.
  const bridgeLists = [
    { userId: 'left-1', items: ['A', 'B', 'C'] }, { userId: 'left-2', items: ['B', 'A', 'C'] },
    { userId: 'right-1', items: ['X', 'Y', 'Z'] }, { userId: 'right-2', items: ['Y', 'X', 'Z'] },
    { userId: 'bridge', items: ['X', 'B'] },
  ];
  result.bridgeExample = analyze(bridgeLists, { seed, bootstrap });
  const prolificBase = Array.from({ length: 30 }, (_, i) => ({ userId: `regular-${i}`, items: ['A', 'B', 'C'] }));
  const prolific = fit([...prolificBase, { userId: 'prolific', items: ['C', ...Array.from({ length: 100 }, (_, i) => `extra-${i}`), 'B', 'A'] }]);
  result.prolificExample = { converged: prolific.converged, majorityOrderPreserved: prolific.strengths.A > prolific.strengths.B && prolific.strengths.B > prolific.strengths.C, note: 'One 103-item list against 30 three-item lists; one list contributes total stage weight 1, rather than 5,253 independent votes.' };
  markdown = `# Supplemental ranking prototype: synthetic results\n\nSeed: ${seed}. User-bootstrap replicates per scenario: ${bootstrap}. All data are simulated. No app behavior or database was changed.\n\n| Scenario | Training / held-out users | Components | PL accuracy | BT accuracy | Mean-score accuracy | PL / BT converged |\n|---|---:|---:|---:|---:|---:|---|\n`;
  for (const s of result.scenarios) markdown += `| ${s.name} | ${s.trainingUsers} / ${s.heldoutUsers} | ${s.analysis.coverage.components.length} | ${percent(s.evaluation.pl.accuracy)} | ${percent(s.evaluation.bt.accuracy)} | ${percent(s.evaluation.meanScore.accuracy)} | ${s.analysis.fit.converged} / ${s.btFit.converged} |\n`;
  markdown += '\nAccuracy means agreement with held-out users on restaurant pairs, averaged equally over evaluable users. Unseen restaurants and cross-component pairs are excluded, with counts recorded in JSON. It is not agreement with objective restaurant quality. The mean-score baseline mirrors numeric averaging; simulated scores are not generated by the app’s score settler.\n\n';
  markdown += '| Scenario | PL agreement with simulated underlying order | Mean agreement with simulated underlying order | Held-out pairs evaluated / skipped | Usable bootstrap replicates (minimum per restaurant) |\n|---|---:|---:|---:|---:|\n';
  for (const s of result.scenarios) markdown += `| ${s.name} | ${percent(s.truthAgreement?.pl)} | ${percent(s.truthAgreement?.meanScore)} | ${s.evaluation.pl.pairs} / ${s.evaluation.pl.skippedPairs} | ${Math.min(...s.analysis.estimates.map(e => e.bootstrapUsable))} |\n`;
  markdown += `\n- Strictly increasing user-specific score transformations preserve all simulated input orders: ${result.scenarios.every(s => s.scaleInvariant)}.\n- Bridge example flags these users as essential to connectivity: ${result.bridgeExample.coverage.fragmentationUsers.join(', ')}. Minimum usable bootstrap replicates: ${Math.min(...result.bridgeExample.estimates.map(e => e.bootstrapUsable))}/${bootstrap}.\n- Prolific-user example preserves the 30-user majority order: ${result.prolificExample.majorityOrderPreserved}; optimizer converged: ${result.prolificExample.converged}.\n- Every estimate is marked publishable=false. Reference scores are experimental, component-restricted, and omitted if the reference set crosses disconnected groups.\n\n## Interpretation and limits\n\nThe connected simulations are generated from PL utilities, so they favor the model’s assumptions. They demonstrate implementation behavior, not real-world validity. Opposing cuisine preferences deliberately violate the single shared preference model; there is no single true order reported for that scenario. PL does not need to outperform Bradley–Terry to justify the underlying approach.\n\nThe selective scenario tests the specific weak-list/strong-list concern with overlapping subsets and correlated score generosity. Disconnected and sparse results must not be presented as a global ranking. The bootstrap intervals are descriptive and conditional on connectivity; few users, one-sided outcomes, strong regularization, or taste disagreement can make them misleadingly narrow.\n\nJSON includes per-restaurant contributor counts, component ranks, 90% bootstrap rank ranges, optimizer diagnostics, held-out log loss for PL/BT, and sensitivity runs at lambda 0.1 and 1 (default 0.3). No publication thresholds or calibrated restaurant-quality scale are established by this experiment. See README.md for the storage audit and next steps.\n`;
}
if (values.output) await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
if (values.report) await writeFile(values.report, markdown);
if (!values.output && values.input) console.log(JSON.stringify(result, null, 2));
console.log(values.report ? `Report written to ${values.report}` : markdown);
