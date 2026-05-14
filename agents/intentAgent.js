/**
 * AGENT 1: Intent Agent
 * Powered by: Google Antigravity (Simulated)
 *
 * Responsibility: Parse raw user input (text/voice) into a structured intent object.
 * Extracts: service type, location, urgency, time preference, and language.
 * Produces a confidence score and full reasoning chain for the Antigravity Trace.
 */

const SERVICE_MAP = {
  'AC Technician': ['ac', 'air condition', 'cooling', 'aircon', 'اے سی', 'ٹھنڈا', 'ac wala', 'thanda', 'ac technician', 'ac service', 'ac repair'],
  'Electrician':   ['electric', 'bijli', 'wiring', 'short circuit', 'light', 'fan', 'بجلی', 'الیکٹریشن', 'socket', 'electrician', 'power'],
  'Plumber':       ['plumber', 'pipe', 'leak', 'pani', 'water', 'tap', 'drain', 'nal', 'toti', 'پلمبر', 'پانی', 'ٹوٹی', 'toilet', 'flush'],
  'Carpenter':     ['carpenter', 'barhai', 'wood', 'door', 'furniture', 'shelf', 'بڑھئی', 'لکڑی', 'almaari', 'table', 'chair repair'],
  'Painter':       ['painter', 'paint', 'rang', 'wall', 'رنگ', 'دیوار', 'painting', 'whitewash', 'distemper'],
  'Car Mechanic':  ['mechanic', 'car', 'gaari', 'vehicle', 'engine', 'مکینک', 'گاڑی', 'auto', 'repair car', 'oil change'],
  'Bike Mechanic': ['bike', 'motorcycle', 'motorbike', 'موٹر سائیکل', 'cycle', 'scooter'],
  'Tyre Repair':   ['tyre', 'tire', 'puncture', 'wheel', 'ٹائر', 'پنکچر', 'flat tyre'],
  'Medical Store': ['medical', 'medicine', 'pharmacy', 'dawai', 'دوا', 'میڈیکل', 'store', 'chemist', 'tablet', 'injection'],
  'Grocery':       ['grocery', 'kiryana', 'ration', 'کرانہ', 'سبزی', 'sabzi', 'vegetables', 'market', 'shop'],
  'Laundry':       ['laundry', 'dhobhi', 'wash', 'dhobi', 'کپڑے', 'ironing', 'press', 'dry clean'],
  'Cook / Chef':   ['cook', 'chef', 'khana', 'کھانا', 'food', 'cooking', 'meal', 'bawarchi', 'باورچی'],
  'Maid / Cleaner':['maid', 'cleaner', 'clean', 'sweep', 'صفائی', 'safai', 'jhadu', 'house help', 'kaam wali'],
};

const LOCATION_PATTERNS = [
  /g[-\s]?(\d+)/i, /f[-\s]?(\d+)/i, /i[-\s]?(\d+)/i, /h[-\s]?(\d+)/i,
  /islamabad/i, /rawalpindi/i, /karachi/i, /lahore/i, /peshawar/i,
  /\b(sector|block|phase|area|town)\s+[\w-]+/i,
  /جی\s*[\d۰-۹]+/, /ایف\s*[\d۰-۹]+/
];

const URGENCY_KEYWORDS = {
  HIGH:   ['emergency', 'urgent', 'jaldi', 'abhi', 'foran', 'immediately', 'asap', 'ابھی', 'فوری', 'جلدی', 'help'],
  MEDIUM: ['today', 'aaj', 'soon', 'آج', 'جلد'],
  LOW:    ['tomorrow', 'kal', 'next week', 'kisi din', 'کل', 'کبھی بھی'],
};

const TIME_PATTERNS = {
  NOW:      ['abhi', 'now', 'immediately', 'فوری', 'ابھی'],
  TODAY:    ['today', 'aaj', 'آج', 'this evening', 'tonight'],
  TOMORROW: ['tomorrow', 'kal', 'کل', 'next day'],
  MORNING:  ['morning', 'subah', 'صبح', 'am'],
  EVENING:  ['evening', 'sham', 'شام', 'afternoon'],
};

function detectService(text) {
  const lower = text.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const [service, keywords] of Object.entries(SERVICE_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        const score = kw.length; // longer keyword = more specific match
        if (score > bestScore) {
          bestScore = score;
          bestMatch = service;
        }
      }
    }
  }
  return { service: bestMatch, confidence: bestMatch ? Math.min(60 + bestScore * 3, 99) : 0 };
}

function detectLocation(text) {
  for (const pattern of LOCATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

function detectUrgency(text) {
  const lower = text.toLowerCase();
  if (URGENCY_KEYWORDS.HIGH.some(k => lower.includes(k)))   return 'HIGH';
  if (URGENCY_KEYWORDS.MEDIUM.some(k => lower.includes(k))) return 'MEDIUM';
  if (URGENCY_KEYWORDS.LOW.some(k => lower.includes(k)))    return 'LOW';
  return 'MEDIUM';
}

function detectTimePreference(text) {
  const lower = text.toLowerCase();
  for (const [time, keywords] of Object.entries(TIME_PATTERNS)) {
    if (keywords.some(k => lower.includes(k))) return time;
  }
  return 'TODAY';
}

function detectLanguage(text) {
  const urduScript = /[\u0600-\u06FF]/.test(text);
  const romanUrdu = /\b(mujhe|chahiye|karo|wala|hai|hain|aur|kal|abhi|jaldi)\b/i.test(text);
  if (urduScript) return 'URDU_SCRIPT';
  if (romanUrdu)  return 'ROMAN_URDU';
  return 'ENGLISH';
}

/**
 * Main export — called by Orchestrator
 * @param {string} userText - raw input
 * @returns {object} IntentResult with trace
 */
function run(userText) {
  const startTime = Date.now();
  const language = detectLanguage(userText);
  const { service, confidence: svcConf } = detectService(userText);
  const location = detectLocation(userText);
  const urgency  = detectUrgency(userText);
  const timePref = detectTimePreference(userText);

  const locConf   = location ? 85 : 20;
  const overallConf = Math.round((svcConf * 0.6) + (locConf * 0.4));

  const reasoning = [
    `Language detected: ${language}`,
    service  ? `✅ Service identified: "${service}" (keyword match, confidence ${svcConf}%)` : `❌ Service: unknown — no keywords matched`,
    location ? `✅ Location extracted: "${location}" (pattern match, confidence ${locConf}%)` : `⚠️  Location: not found — will use default area`,
    `⚡ Urgency level: ${urgency} (based on tone keywords)`,
    `🕐 Time preference: ${timePref}`,
    `📊 Overall intent confidence: ${overallConf}%`,
  ];

  return {
    agent: 'Intent Agent',
    status: service ? 'SUCCESS' : 'PARTIAL',
    processingMs: Date.now() - startTime,
    input: userText,
    output: {
      service:        service || 'Unknown',
      location:       location || 'Islamabad',
      urgency,
      timePreference: timePref,
      language,
      confidence:     overallConf,
    },
    reasoning,
  };
}

module.exports = { run };
