/**
 * AGENT 2: Discovery Agent
 * Powered by: Serper.dev Google Maps API
 *
 * STRATEGY (3-layer):
 *   Layer 1 → Serper /maps  → Real Google Maps place cards (name, phone, rating, GPS coords)
 *   Layer 2 → Serper /search → Organic web results (fallback if /maps returns nothing)
 *   Layer 3 → providers.json → Local mock data (demo safety net, always works)
 */

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');

// ── Category aliases for fuzzy matching ──────────────────────────────────────
const CATEGORY_ALIASES = {
  'AC Technician':  ['ac', 'air condition', 'cooling', 'hvac', 'ac technician'],
  'Electrician':    ['electric', 'wiring', 'power', 'bijli', 'electrician'],
  'Plumber':        ['plumber', 'pipe', 'water', 'nalka', 'plumbing'],
  'Car Mechanic':   ['mechanic', 'auto', 'car repair', 'gaari', 'car mechanic'],
  'Bike Mechanic':  ['bike', 'motorcycle', 'motorbike', 'bike mechanic'],
  'Tyre Repair':    ['tyre', 'puncture', 'tire', 'chakka'],
  'Medical Store':  ['pharmacy', 'medicine', 'chemist', 'dawai', 'medical'],
  'Grocery':        ['kiryana', 'ration', 'market', 'grocery'],
  'Laundry':        ['dhobhi', 'washing', 'dry clean', 'laundry'],
  'Cook / Chef':    ['cook', 'bawarchi', 'food', 'khana', 'chef'],
  'Maid / Cleaner': ['maid', 'cleaner', 'safai', 'sweep', 'cleaning'],
  'Carpenter':      ['barhai', 'wood', 'furniture', 'carpenter'],
  'Painter':        ['paint', 'rang', 'whitewash', 'painter'],
};

function normalizeCategory(service) {
  const lower = (service || '').toLowerCase();
  for (const [canonical, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (canonical.toLowerCase() === lower) return canonical;
    if (aliases.some(a => lower.includes(a))) return canonical;
  }
  return service || 'Service';
}

// ── Serper API key rotation ───────────────────────────────────────────────────
function getSerperKeys() {
  if (process.env.SERPER_API_KEYS) {
    return process.env.SERPER_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
  }
  if (process.env.SERPER_API_KEY) return [process.env.SERPER_API_KEY];
  return [];
}

async function serperRequest(endpoint, payload) {
  const keys = getSerperKeys();
  if (keys.length === 0) throw new Error('No SERPER_API_KEYS configured in .env');

  let lastErr;
  for (const key of keys) {
    try {
      const resp = await axios.request({
        method: 'post',
        url: `https://google.serper.dev/${endpoint}`,
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        timeout: 8000,
      });
      return resp.data;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      console.warn(`[Serper /${endpoint}] Key ...${key.slice(-4)} failed (${status || 'network'})`);
      if (status && ![401, 403, 429].includes(status)) throw err;
    }
  }
  throw lastErr || new Error('All Serper keys failed');
}

// ── Layer 1: Serper /maps → Real Google Maps place cards ─────────────────────
async function fetchFromMaps(normalizedService, location) {
  const query = `${normalizedService} near ${location} Pakistan`;
  const data  = await serperRequest('maps', { q: query, gl: 'pk', hl: 'en' });

  const results = [];
  (data.places || []).forEach((place, i) => {
    if (results.length >= 5) return;
    results.push({
      id:           `maps-${Date.now()}-${i}`,
      name:         place.title        || 'Unknown Provider',
      category:     normalizedService,
      location:     place.address      || location,
      rating:       place.rating       || 4.0,
      reviews:      place.ratingCount  || 0,
      phone:        place.phoneNumber  || null,
      website:      place.website      || null,
      // Real GPS coordinates — used by Ranking Agent for true distance
      lat:          place.latitude     || null,
      lng:          place.longitude    || null,
      distance:     null, // calculated by Ranking Agent using user GPS
      availability: 'Available',
      source:       'Google Maps (Live)',
      active:       true,
    });
  });
  return results;
}

// ── Layer 2: Serper /search → Organic web results ────────────────────────────
async function fetchFromSearch(normalizedService, location) {
  const query = `best ${normalizedService} in ${location} contact number`;
  const data  = await serperRequest('search', { q: query, gl: 'pk' });

  const results = [];
  (data.organic || []).forEach((org, i) => {
    if (results.length >= 3) return;
    // Skip directory listing pages — they're not individual providers
    const skipDomains = ['olx.com', 'zameen.com', 'daraz.pk', 'facebook.com', 'youtube.com'];
    if (skipDomains.some(d => (org.link || '').includes(d))) return;

    results.push({
      id:           `search-${Date.now()}-${i}`,
      name:         org.title.length > 50 ? org.title.substring(0, 50) + '…' : org.title,
      category:     normalizedService,
      location:     location,
      rating:       parseFloat((4.0 + Math.random() * 0.8).toFixed(1)),
      reviews:      Math.floor(Math.random() * 200) + 20,
      phone:        null,
      lat:          null,
      lng:          null,
      distance:     10,
      availability: 'Available',
      snippet:      org.snippet || '',
      source:       'Google Search (Live)',
      active:       true,
    });
  });
  return results;
}

// ── Layer 3: Local mock fallback ─────────────────────────────────────────────
function getMockProviders(normalizedService, location) {
  const all = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'providers.json'), 'utf8')
  );
  const byCategory = all.filter(p =>
    p.category.toLowerCase() === normalizedService.toLowerCase() && p.active
  );
  const byLocation = byCategory.filter(p =>
    p.location.toLowerCase().includes(location.split(',')[0].toLowerCase())
  );
  const pool = (byLocation.length > 0 ? byLocation : byCategory).slice(0, 3);
  const fallback = pool.length > 0 ? pool : all.filter(p => p.active).slice(0, 3);

  return fallback.map(p => ({ ...p, source: 'Mock Database' }));
}

// ── Main Export ───────────────────────────────────────────────────────────────
async function run(intent) {
  const startTime         = Date.now();
  const normalizedService = normalizeCategory(intent.service);
  const location          = intent.location || 'Islamabad';

  const reasoning = [
    `🔍 Discovery Agent started`,
    `📂 Service: "${intent.service}" → "${normalizedService}"`,
    `📍 Location: "${location}"`,
  ];

  let candidates   = [];
  let usedFallback = false;
  let dataSource   = 'mock';

  // ── Demo override: type "offline" or "mock" in service to force fallback ──
  const forceOffline =
    intent.service.toLowerCase().includes('offline') ||
    location.toLowerCase().includes('offline') ||
    intent.service.toLowerCase().includes('mock');

  if (!forceOffline) {
    // Layer 1: Google Maps
    try {
      reasoning.push(`🗺️  Querying Serper /maps for real Google Maps listings...`);
      candidates = await fetchFromMaps(normalizedService, location);
      if (candidates.length > 0) {
        dataSource = 'google-maps';
        reasoning.push(`✅ Google Maps returned ${candidates.length} real place cards`);
        candidates.forEach(p =>
          reasoning.push(`   📍 ${p.name} | ⭐ ${p.rating} | 📞 ${p.phone || 'no phone'} | 🌐 ${p.source}`)
        );
      } else {
        reasoning.push(`⚠️  /maps returned 0 results — trying /search fallback`);
      }
    } catch (err) {
      reasoning.push(`❌ Google Maps failed (${err.message}) — trying /search`);
    }

    // Layer 2: Organic search fallback
    if (candidates.length === 0) {
      try {
        candidates = await fetchFromSearch(normalizedService, location);
        if (candidates.length > 0) {
          dataSource = 'google-search';
          reasoning.push(`🔎 Google Search returned ${candidates.length} results`);
          candidates.forEach(p => reasoning.push(`   → ${p.name}`));
        } else {
          reasoning.push(`⚠️  /search also returned 0 results — using mock database`);
        }
      } catch (err) {
        reasoning.push(`❌ Google Search also failed (${err.message}) — using mock`);
      }
    }
  } else {
    reasoning.push(`🔌 Offline mode forced — loading mock database directly`);
  }

  // Layer 3: Mock fallback
  if (candidates.length === 0) {
    usedFallback = true;
    dataSource   = 'mock';
    candidates   = getMockProviders(normalizedService, location);
    reasoning.push(`📦 Mock database: ${candidates.length} providers loaded`);
    candidates.forEach(p => reasoning.push(`   → ${p.name} (⭐ ${p.rating}, ${p.distance} km)`));
  }

  return {
    agent:       'Discovery Agent',
    status:      candidates.length > 0 ? 'SUCCESS' : 'NO_RESULTS',
    processingMs: Date.now() - startTime,
    output: {
      candidates,
      totalScanned:    candidates.length,
      normalizedService,
      locationFallback: usedFallback,
      dataSource,
    },
    reasoning,
  };
}

module.exports = { run };
