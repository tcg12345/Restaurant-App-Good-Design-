// Offline research only. No app imports, database access, or dependencies.
export function validateRankings(rankings) {
  if (!Array.isArray(rankings)) throw new Error('Expected an array of rankings');
  const users = new Set();
  for (const row of rankings) {
    if (!row || typeof row.userId !== 'string' || !row.userId.trim() || users.has(row.userId)) {
      throw new Error('Each user must have exactly one current ranking and a nonempty userId');
    }
    users.add(row.userId);
    if (!Array.isArray(row.items) || row.items.some(id => typeof id !== 'string' || !id.trim()) || new Set(row.items).size !== row.items.length) {
      throw new Error('items must be distinct restaurant IDs in strict best-to-worst order; ties are not supported');
    }
  }
  return rankings;
}

/** Conservative adapter for a minimal, manually supplied export. Never fetches data.
 * Missing method and slider rows are excluded by default. Equal-score lists are
 * excluded instead of fabricating a strict preference. Historical synthetic ties
 * cannot be recovered from scores; all converted lists are marked inferred.
 */
export function fromAppSnapshots(snapshots, { includeLegacy = false } = {}) {
  if (!Array.isArray(snapshots)) throw new Error('Expected an array of user snapshots');
  const report = { users: snapshots.length, excludedSlider: 0, excludedLegacy: 0, excludedUnknownMethod: 0, invalidRows: 0, tiedUsers: [], shortUsers: [], inferredUsers: 0 };
  const rankings = [];
  const seenUsers = new Set();
  for (const snapshot of snapshots) {
    const { userId, ratings } = snapshot;
    if (typeof userId !== 'string' || !userId.trim() || seenUsers.has(userId) || !Array.isArray(ratings)) throw new Error('Invalid or repeated user snapshot');
    seenUsers.add(userId);
    const seenItems = new Set();
    const usable = [];
    for (const row of ratings) {
      if (!row || typeof row.restaurantId !== 'string' || !row.restaurantId.trim() || !Number.isFinite(row.score) || row.score < 0 || row.score > 10) { report.invalidRows++; continue; }
      if (seenItems.has(row.restaurantId)) throw new Error(`Duplicate restaurant in snapshot for ${userId}; resolve current state before fitting`);
      seenItems.add(row.restaurantId);
      if (row.ratingMethod === 'slider') { report.excludedSlider++; continue; }
      if (row.ratingMethod == null && !includeLegacy) { report.excludedLegacy++; continue; }
      if (row.ratingMethod != null && !['h2h', 'import'].includes(row.ratingMethod)) { report.excludedUnknownMethod++; continue; }
      usable.push(row);
    }
    usable.sort((a, b) => b.score - a.score);
    if (usable.some((r, i) => i > 0 && r.score === usable[i - 1].score)) { report.tiedUsers.push(userId); continue; }
    if (usable.length < 2) report.shortUsers.push(userId);
    if (usable.length) report.inferredUsers++;
    rankings.push({ userId, items: usable.map(r => r.restaurantId), provenance: 'inferred-from-stored-scores' });
  }
  return { rankings: validateRankings(rankings), report };
}

function components(rankings, ids) {
  const parent = new Map(ids.map(id => [id, id]));
  function root(id) {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r);
    while (id !== r) { const next = parent.get(id); parent.set(id, r); id = next; }
    return r;
  }
  for (const { items } of rankings) for (let i = 1; i < items.length; i++) parent.set(root(items[i]), root(items[0]));
  const groups = new Map();
  for (const id of ids) { const r = root(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
  return [...groups.values()].map(g => g.sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

function stronglyConnectedComponents(rankings, ids) {
  const forward = new Map(ids.map(id => [id, new Set()])), backward = new Map(ids.map(id => [id, new Set()]));
  for (const { items } of rankings) for (let i = 1; i < items.length; i++) {
    forward.get(items[i - 1]).add(items[i]); backward.get(items[i]).add(items[i - 1]);
  }
  function reachable(start, edges) {
    const seen = new Set([start]), queue = [start];
    for (let i = 0; i < queue.length; i++) for (const id of edges.get(queue[i])) if (!seen.has(id)) { seen.add(id); queue.push(id); }
    return seen;
  }
  const remaining = new Set(ids), groups = [];
  for (const id of ids) {
    if (!remaining.has(id)) continue;
    const a = reachable(id, forward), b = reachable(id, backward);
    const group = ids.filter(other => a.has(other) && b.has(other));
    group.forEach(other => remaining.delete(other)); groups.push(group);
  }
  return groups;
}

export function audit(rankings, { checkUserRemoval = true } = {}) {
  validateRankings(rankings);
  const ids = [...new Set(rankings.flatMap(r => r.items))].sort();
  const groups = components(rankings, ids);
  const stats = new Map(ids.map(id => [id, { id, contributors: 0, comparisonUsers: 0, opponents: new Set(), wins: 0, losses: 0 }]));
  for (const { items } of rankings) items.forEach((id, i) => {
    const s = stats.get(id); s.contributors++;
    if (items.length > 1) s.comparisonUsers++;
    s.wins += items.length - i - 1; s.losses += i;
    for (const other of items) if (other !== id) s.opponents.add(other);
  });
  const fragmentationUsers = checkUserRemoval ? rankings.filter((_, i) => components(rankings.filter((__, j) => i !== j), ids).length > groups.length).map(r => r.userId) : [];
  return {
    users: rankings.length,
    informativeUsers: rankings.filter(r => r.items.length >= 2).length,
    restaurants: ids.length,
    components: groups,
    stronglyConnectedComponents: stronglyConnectedComponents(rankings, ids),
    globallyConnected: ids.length > 1 && groups.length === 1,
    fragmentationUsers,
    userRemovalChecked: checkUserRemoval,
    restaurantsDetail: [...stats.values()].map(s => ({ ...s, opponents: s.opponents.size, oneSided: s.comparisonUsers > 0 && (!s.wins || !s.losses) })),
  };
}

export const sigmoid = x => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
const softplus = x => Math.max(0, x) + Math.log1p(Math.exp(-Math.abs(x)));

/** Penalized negative log likelihood. Each user's list has total stage weight 1.
 * PL: sum of log(sum exp(theta remaining)) - theta winner, divided by n-1.
 * BT baseline: all implied pairs, each weighted 1 / choose(n, 2).
 * Both use lambda/2 * sum(theta^2); their lambda values are not equivalent priors
 * on equal amounts of raw evidence. Fit each baseline separately for production.
 */
export function objective(theta, lists, { model = 'pl', lambda = 0.3 } = {}) {
  let loss = 0;
  const gradient = theta.map(t => lambda * t);
  for (const t of theta) loss += lambda * t * t / 2;
  for (const list of lists) {
    const n = list.length;
    if (n < 2) continue;
    if (model === 'bt') {
      const weight = 2 / (n * (n - 1));
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        const i = list[a], j = list[b], diff = theta[i] - theta[j];
        loss += weight * softplus(-diff);
        const g = -weight * sigmoid(-diff);
        gradient[i] += g; gradient[j] -= g;
      }
    } else {
      // Suffix log-sum-exp avoids underflow even for extreme finite strengths.
      const suffix = new Array(n);
      suffix[n - 1] = theta[list[n - 1]];
      for (let k = n - 2; k >= 0; k--) {
        const a = theta[list[k]], b = suffix[k + 1];
        suffix[k] = Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));
      }
      const weight = 1 / (n - 1);
      // Running log(sum 1 / suffix_denominator) gives an O(n) gradient.
      let logPrefix = -Infinity;
      for (let k = 0; k < n; k++) {
        if (k < n - 1) {
          loss += weight * (suffix[k] - theta[list[k]]);
          gradient[list[k]] -= weight;
          const term = -suffix[k];
          logPrefix = logPrefix === -Infinity ? term : Math.max(logPrefix, term) + Math.log1p(Math.exp(-Math.abs(logPrefix - term)));
        }
        gradient[list[k]] += weight * Math.exp(theta[list[k]] + logPrefix);
      }
    }
  }
  return { loss, gradient };
}

export function fit(rankings, { model = 'pl', lambda = 0.3, maxIterations = 1500, tolerance = 1e-5, universe } = {}) {
  validateRankings(rankings);
  if (!['pl', 'bt'].includes(model) || !Number.isFinite(lambda) || lambda <= 0 || !Number.isInteger(maxIterations) || maxIterations < 1 || !Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Invalid fit options');
  const ids = universe ?? [...new Set(rankings.flatMap(r => r.items))].sort();
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Invalid universe');
  const index = new Map(ids.map((id, i) => [id, i]));
  const lists = rankings.map(r => r.items.map(id => { if (!index.has(id)) throw new Error('Universe is missing restaurant'); return index.get(id); }));
  let theta = ids.map(() => 0), current = objective(theta, lists, { model, lambda }), step = 1;
  let iterations = 0;
  const norm = g => g.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  while (iterations < maxIterations && norm(current.gradient) > tolerance) {
    const normSquared = current.gradient.reduce((s, g) => s + g * g, 0);
    let accepted = false;
    for (let backtrack = 0; backtrack < 60; backtrack++) {
      const nextTheta = theta.map((t, i) => t - step * current.gradient[i]);
      const next = objective(nextTheta, lists, { model, lambda });
      // Near the optimum, the predicted decrease can be below summation
      // precision. A roundoff allowance avoids a vanishing step while the
      // independently checked gradient still decides convergence.
      const roundoff = 8 * Number.EPSILON * Math.max(1, Math.abs(current.loss));
      if (Number.isFinite(next.loss) && next.loss <= current.loss - 1e-4 * step * normSquared + roundoff) {
        theta = nextTheta; current = next; accepted = true; step = Math.min(step * 1.5, 10); break;
      }
      step /= 2;
    }
    if (!accepted) break;
    iterations++;
  }
  return { model, lambda, tolerance, strengths: Object.fromEntries(ids.map((id, i) => [id, theta[i]])), iterations, converged: norm(current.gradient) <= tolerance, maxGradient: norm(current.gradient), objective: current.loss };
}

export function random(seed = 42) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * p;
  return sorted[Math.floor(at)] + (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at % 1);
};
const ranks = (strengths, ids) => Object.fromEntries(ids.map(id => [id, 1 + ids.filter(other => strengths[other] > strengths[id] + 1e-8).length + ids.filter(other => other !== id && Math.abs(strengths[other] - strengths[id]) <= 1e-8).length / 2]));

/** Descriptive user bootstrap, NOT a posterior or a launch criterion.
 * Only component-preserving, converged replicates contribute intervals.
 * Connectivity failures are reported; one-user samples never get intervals.
 */
export function analyze(rankings, { bootstrap = 80, seed = 42, referenceIds = [], ...fitOptions } = {}) {
  if (!Number.isInteger(bootstrap) || bootstrap < 0) throw new Error('Invalid bootstrap count');
  const coverage = audit(rankings), fitted = fit(rankings, fitOptions), ids = coverage.components.flat();
  if (!Array.isArray(referenceIds) || new Set(referenceIds).size !== referenceIds.length || referenceIds.some(id => !ids.includes(id))) throw new Error('References must be distinct observed restaurant IDs');
  const rng = random(seed), samples = new Map(ids.map(id => [id, []]));
  let nonconverged = 0;
  for (let b = 0; b < bootstrap && rankings.length; b++) {
    const sample = rankings.map((_, k) => ({ ...rankings[Math.floor(rng() * rankings.length)], userId: `bootstrap-${k}` }));
    const result = fit(sample, { ...fitOptions, universe: ids });
    if (!result.converged) { nonconverged++; continue; }
    const sampleGroups = components(sample, ids);
    for (const group of coverage.components) {
      if (!sampleGroups.some(g => g.length === group.length && g.every(id => group.includes(id)))) continue;
      const r = ranks(result.strengths, group);
      for (const id of group) samples.get(id).push(r[id]);
    }
  }
  const estimates = coverage.components.map((group, component) => {
    const r = ranks(fitted.strengths, group);
    const groupUsers = rankings.filter(row => row.items.length > 1 && row.items.some(id => group.includes(id))).length;
    return group.map(id => {
      const values = samples.get(id), detail = coverage.restaurantsDetail.find(row => row.id === id);
      const reasons = [];
      if (group.length === 1) reasons.push('no comparisons');
      if (detail.comparisonUsers < 2) reasons.push('fewer than two independent comparison users');
      if (detail.oneSided) reasons.push('only wins or only losses; magnitude depends on regularization');
      if (coverage.stronglyConnectedComponents.find(g => g.includes(id)).length < group.length) reasons.push('no bidirectional preference path to all component restaurants; regularization supplies finite strengths');
      if (coverage.fragmentationUsers.some(uid => rankings.find(row => row.userId === uid).items.includes(id))) reasons.push('exposed to a user whose removal fragments coverage');
      if (values.length < bootstrap) reasons.push('some bootstrap fits failed or disconnected this component');
      if (!fitted.converged) reasons.push('optimizer did not converge');
      const refsAvailable = referenceIds.length > 0 && referenceIds.every(ref => group.includes(ref)) && group.length > 1 && fitted.converged;
      return {
        id, component: component + 1, componentRank: group.length > 1 ? r[id] : null,
        logStrength: fitted.strengths[id],
        rankInterval90: fitted.converged && groupUsers >= 2 && values.length >= 20 ? [quantile(values, 0.05), quantile(values, 0.95)] : null,
        bootstrapUsable: values.length,
        // Fixed benchmark interpretation: 1 + 9 * mean P(preferred to ref).
        // Includes a self-reference at probability 0.5 when present.
        experimentalReferenceScore: refsAvailable ? 1 + 9 * referenceIds.reduce((s, ref) => s + sigmoid(fitted.strengths[id] - fitted.strengths[ref]), 0) / referenceIds.length : null,
        reasons, publishable: false,
      };
    }).sort((a, b) => (a.componentRank ?? Infinity) - (b.componentRank ?? Infinity));
  }).flat();
  return { researchOnly: true, coverage, fit: fitted, bootstrap: { requested: bootstrap, nonconverged, interval: '90% user-bootstrap rank range, conditional on preserved component connectivity' }, referenceIds, estimates };
}

/** Held-out users only; scores must be fit on training users. Coverage excludes
 * unseen restaurants and cross-component pairs. Each evaluable user has weight 1.
 */
export function evaluate(rankings, strengths, groups) {
  validateRankings(rankings);
  const component = new Map(groups.flatMap((g, i) => g.map(id => [id, i])));
  let correct = 0, logLoss = 0, users = 0, pairs = 0, skippedPairs = 0;
  for (const { items } of rankings) {
    let n = 0, hits = 0, loss = 0;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (!Number.isFinite(strengths[a]) || !Number.isFinite(strengths[b]) || !component.has(a) || component.get(a) !== component.get(b)) { skippedPairs++; continue; }
      const d = strengths[a] - strengths[b];
      hits += Math.abs(d) < 1e-8 ? 0.5 : Number(d > 0); loss += softplus(-d); n++;
    }
    if (n) { correct += hits / n; logLoss += loss / n; pairs += n; users++; }
  }
  return { users, pairs, skippedPairs, accuracy: users ? correct / users : null, pairLogLoss: users ? logLoss / users : null };
}
