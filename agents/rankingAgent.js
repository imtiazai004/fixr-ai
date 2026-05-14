/**
 * AGENT 3: Ranking Agent
 * Powered by: Google Antigravity (Simulated)
 *
 * Responsibility: Score and rank all candidate providers from Discovery Agent.
 * Scoring formula:
 *   Score = (rating × 0.40) + (proximity × 0.30) + (availability × 0.20) + (reviews × 0.10)
 *
 * Urgency modifier: HIGH urgency boosts 'Available Now' providers by +15 points.
 * Returns ranked list with individual score breakdowns.
 */

const MAX_DISTANCE = 20; // km — for normalization

function proximityScore(distanceKm) {
  // Closer = higher score. Max 10 points.
  const clamped = Math.min(distanceKm, MAX_DISTANCE);
  return parseFloat(((1 - clamped / MAX_DISTANCE) * 10).toFixed(2));
}

function availabilityScore(availability) {
  const a = (availability || '').toLowerCase();
  if (a === 'available')      return 10;
  if (a === 'busy')           return 3;
  if (a === 'unavailable')    return 0;
  return 5; // default
}

function reviewScore(reviewCount) {
  // Log scale: 0 reviews = 0, 100+ reviews = 10
  if (!reviewCount) return 0;
  return parseFloat(Math.min(Math.log10(reviewCount + 1) * 5, 10).toFixed(2));
}

function computeScore(provider, urgency) {
  const r   = ((provider.rating || 0) / 5) * 10;        // 0–10
  const p   = proximityScore(provider.distance || 10);    // 0–10
  const a   = availabilityScore(provider.availability);   // 0–10
  const rev = reviewScore(provider.reviews || 0);         // 0–10

  const raw = (r * 0.40) + (p * 0.30) + (a * 0.20) + (rev * 0.10);

  // Urgency boost: if HIGH urgency, reward available providers
  const urgencyBonus = (urgency === 'HIGH' && a === 10) ? 1.5 : 0;

  const final = parseFloat(Math.min(raw + urgencyBonus, 10).toFixed(2));

  return {
    total:      final,
    breakdown: {
      rating:       parseFloat(r.toFixed(2)),
      proximity:    p,
      availability: a,
      reviews:      rev,
      urgencyBonus: parseFloat(urgencyBonus.toFixed(2)),
    },
  };
}

/**
 * Main export — called by Orchestrator
 * @param {object} discoveryResult - output from Discovery Agent
 * @param {object} intent          - output from Intent Agent
 * @returns {object} RankingResult with trace
 */
function run(discoveryResult, intent) {
  const startTime = Date.now();
  const { candidates, normalizedService } = discoveryResult.output;

  if (!candidates || candidates.length === 0) {
    return {
      agent: 'Ranking Agent',
      status: 'SKIPPED',
      processingMs: Date.now() - startTime,
      output: { ranked: [], topPick: null },
      reasoning: ['⚠️  No candidates to rank. Skipping.'],
    };
  }

  const scored = candidates.map(p => {
    const score = computeScore(p, intent.urgency);
    return { ...p, score };
  });

  // Sort descending by total score
  scored.sort((a, b) => b.score.total - a.score.total);
  const topPick = scored[0];

  const reasoning = [
    `🏆 Ranking ${scored.length} candidates for "${normalizedService}"`,
    `📐 Formula: Rating×0.4 + Proximity×0.3 + Availability×0.2 + Reviews×0.1`,
    intent.urgency === 'HIGH' ? `🚨 Urgency BOOST (+1.5) applied to available providers` : ``,
    ``,
    ...scored.map((p, i) =>
      `${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} #${i + 1} ${p.name} — Score: ${p.score.total}/10` +
      ` (Rating:${p.score.breakdown.rating}, Proximity:${p.score.breakdown.proximity}, Avail:${p.score.breakdown.availability})`
    ),
    ``,
    `✅ Top pick: ${topPick.name} with score ${topPick.score.total}/10`,
  ].filter(Boolean);

  return {
    agent: 'Ranking Agent',
    status: 'SUCCESS',
    processingMs: Date.now() - startTime,
    output: { ranked: scored, topPick },
    reasoning,
  };
}

module.exports = { run };
