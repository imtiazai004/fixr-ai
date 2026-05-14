/**
 * AGENT 2: Discovery Agent
 * Powered by: Google Antigravity (Simulated)
 *
 * Responsibility: Search the provider database and return all candidates
 * that match the requested service and location from the Intent Agent output.
 * Applies fuzzy matching for location and category synonyms.
 */

const CATEGORY_ALIASES = {
  'AC Technician':  ['ac', 'air condition', 'cooling'],
  'Electrician':    ['electric', 'wiring', 'power'],
  'Plumber':        ['plumber', 'pipe', 'water'],
  'Car Mechanic':   ['mechanic', 'auto', 'car repair'],
  'Bike Mechanic':  ['bike', 'motorcycle'],
  'Tyre Repair':    ['tyre', 'puncture', 'tire'],
  'Medical Store':  ['pharmacy', 'medicine', 'chemist'],
  'Grocery':        ['kiryana', 'ration', 'market'],
  'Laundry':        ['dhobhi', 'washing', 'dry clean'],
  'Cook / Chef':    ['cook', 'bawarchi', 'food'],
  'Maid / Cleaner': ['maid', 'cleaner', 'safai'],
  'Carpenter':      ['barhai', 'wood', 'furniture'],
  'Painter':        ['paint', 'rang', 'whitewash'],
};

function normalizeCategory(service) {
  const lower = service.toLowerCase();
  for (const [canonical, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (canonical.toLowerCase() === lower) return canonical;
    if (aliases.some(a => lower.includes(a))) return canonical;
  }
  return service;
}

function locationMatch(providerLocation, requestedLocation) {
  if (!requestedLocation) return true; // no location filter
  const pLoc  = providerLocation.toLowerCase();
  const rLoc  = requestedLocation.toLowerCase();

  // Direct match
  if (pLoc.includes(rLoc) || rLoc.includes(pLoc)) return true;

  // Sector-level match (e.g. "G-13/1" matches "G-13")
  const sectorMatch = rLoc.match(/([a-z][-\s]?\d+)/i);
  if (sectorMatch && pLoc.includes(sectorMatch[1].toLowerCase())) return true;

  // City-level fallback
  const cities = ['islamabad', 'rawalpindi', 'karachi', 'lahore'];
  for (const city of cities) {
    if (pLoc.includes(city) && rLoc.includes(city)) return true;
  }

  return false;
}

/**
 * Main export — called by Orchestrator
 * @param {object} intent   - output from Intent Agent
 * @param {Array}  providers - full provider database
 * @returns {object} DiscoveryResult with trace
 */
function run(intent, providers) {
  const startTime = Date.now();
  const normalizedService = normalizeCategory(intent.service);
  const scanned = providers.length;

  const candidates = providers.filter(p => {
    const categoryMatch  = p.category.toLowerCase() === normalizedService.toLowerCase();
    const locMatch       = locationMatch(p.location, intent.location);
    const isActive       = p.active !== false; // exclude disabled providers
    return categoryMatch && locMatch && isActive;
  });

  // If no exact location match, fall back to same city
  let finalCandidates = candidates;
  let fallback = false;
  if (candidates.length === 0) {
    finalCandidates = providers.filter(p =>
      p.category.toLowerCase() === normalizedService.toLowerCase() && p.active !== false
    );
    fallback = true;
  }

  const reasoning = [
    `🔍 Scanning provider database: ${scanned} total providers`,
    `📂 Normalized service: "${intent.service}" → "${normalizedService}"`,
    `📍 Location filter: "${intent.location}"`,
    fallback
      ? `⚠️  No exact location match. Expanding search to all areas.`
      : `✅ Location filter applied.`,
    `📋 Candidates found: ${finalCandidates.length} provider(s)`,
    ...finalCandidates.map(p => `   → ${p.name} (${p.location}, ⭐${p.rating})`),
  ];

  return {
    agent: 'Discovery Agent',
    status: finalCandidates.length > 0 ? 'SUCCESS' : 'NO_RESULTS',
    processingMs: Date.now() - startTime,
    output: {
      candidates: finalCandidates,
      totalScanned: scanned,
      locationFallback: fallback,
      normalizedService,
    },
    reasoning,
  };
}

module.exports = { run };
