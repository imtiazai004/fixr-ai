/**
 * AGENT 3: Ranking Agent
 * Powered by: Google Antigravity
 *
 * Scoring formula:
 *   Score = (rating × 0.40) + (proximity × 0.30) + (availability × 0.20) + (reviews × 0.10)
 *
 * Real distance: calculated via Haversine if both user GPS and provider GPS are available.
 * Urgency modifier: HIGH urgency gives +1.5 bonus to "Available" providers.
 */

const MAX_DISTANCE = 20; // km — used for normalization

// ── Haversine formula: true distance between two GPS points ──────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1));
}

function proximityScore(distanceKm) {
  const clamped = Math.min(distanceKm || MAX_DISTANCE, MAX_DISTANCE);
  return parseFloat(((1 - clamped / MAX_DISTANCE) * 10).toFixed(2));
}

function availabilityScore(availability) {
  const a = (availability || '').toLowerCase();
  if (a === 'available')   return 10;
  if (a === 'busy')        return 3;
  if (a === 'unavailable') return 0;
  return 5;
}

function reviewScore(reviewCount) {
  if (!reviewCount) return 0;
  return parseFloat(Math.min(Math.log10(reviewCount + 1) * 5, 10).toFixed(2));
}

function computeScore(provider, urgency) {
  const r   = ((provider.rating || 0) / 5) * 10;
  const p   = proximityScore(provider.distance);
  const a   = availabilityScore(provider.availability);
  const rev = reviewScore(provider.reviews || 0);
  const raw = (r * 0.40) + (p * 0.30) + (a * 0.20) + (rev * 0.10);
  const urgencyBonus = (urgency === 'HIGH' && a === 10) ? 1.5 : 0;

  return {
    total: parseFloat(Math.min(raw + urgencyBonus, 10).toFixed(2)),
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
 * @param {object} discoveryResult  — output from Discovery Agent
 * @param {object} intent           — output from Intent Agent
 * @param {object} userLocation     — { lat, lng } from browser GPS (optional)
 */
function run(discoveryResult, intent, userLocation = null) {
  const startTime = Date.now();
  const { candidates, normalizedService } = discoveryResult.output;
  const reasoning = [];

  if (!candidates || candidates.length === 0) {
    return {
      agent: 'Ranking Agent',
      status: 'SKIPPED',
      processingMs: Date.now() - startTime,
      output: { ranked: [], topPick: null },
      reasoning: ['⚠️  No candidates to rank. Skipping.'],
    };
  }

  // ── Inject real distances if user location is known ───────────────────────
  let realDistanceCount = 0;
  if (userLocation && userLocation.lat && userLocation.lng) {
    candidates.forEach(p => {
      if (p.lat && p.lng) {
        p.distance = haversineKm(userLocation.lat, userLocation.lng, p.lat, p.lng);
        realDistanceCount++;
      } else if (!p.distance) {
        p.distance = MAX_DISTANCE; // worst-case if no GPS available
      }
    });
    if (realDistanceCount > 0) {
      reasoning.push(`📡 Real GPS distances calculated for ${realDistanceCount}/${candidates.length} providers`);
    }
  } else {
    reasoning.push(`📍 No user GPS — using provider distance field (or ${MAX_DISTANCE}km default)`);
  }

  // ── Score and sort ────────────────────────────────────────────────────────
  const scored = candidates.map(p => ({ ...p, score: computeScore(p, intent.urgency) }));
  scored.sort((a, b) => b.score.total - a.score.total);
  const topPick = scored[0];

  reasoning.push(`🏆 Ranking ${scored.length} candidates for "${normalizedService}"`);
  reasoning.push(`📐 Formula: Rating×0.4 + Proximity×0.3 + Availability×0.2 + Reviews×0.1`);
  if (intent.urgency === 'HIGH') reasoning.push(`🚨 Urgency BOOST (+1.5) applied to available providers`);
  scored.forEach((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || `  #${i + 1}`;
    const dist  = p.distance != null ? `${p.distance} km` : 'unknown dist';
    reasoning.push(`${medal} ${p.name} — Score: ${p.score.total}/10 | ⭐ ${p.rating} | 📍 ${dist} | 📞 ${p.phone || 'no phone'}`);
  });
  reasoning.push(`✅ Top pick: ${topPick.name} (score ${topPick.score.total}/10)`);

  return {
    agent: 'Ranking Agent',
    status: 'SUCCESS',
    processingMs: Date.now() - startTime,
    output: { ranked: scored, topPick },
    reasoning: reasoning.filter(Boolean),
  };
}

module.exports = { run };
