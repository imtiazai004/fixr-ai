/**
 * AGENT 1: Intent Agent
 * Powered by: Google Gemini 1.5 Flash (with keyword fallback)
 *
 * Responsibility: Parse raw user input (text/voice) into a structured intent object.
 * Extracts: service type, location, urgency, time preference, and language.
 * Produces a confidence score and full reasoning chain for the Antigravity Trace.
 *
 * Strategy:
 *   1. Try Gemini AI extraction (handles natural multilingual phrasing).
 *   2. If Gemini fails or returns low confidence, fall back to keyword matching.
 *   3. State-based conversational shortcuts (TIME / CONFIRMATION) bypass extraction.
 */

const geminiService = require('../geminiService');

const SERVICE_MAP = {
  'AC Technician': ['ac', 'air condition', 'cooling', 'aircon', 'اے سی', 'ٹھنڈا', 'ac wala', 'thanda', 'ac technician', 'ac service', 'ac repair', 'eaton', 'ec', 'a c', 'cooling wala', 'thanda karne', 'air conditioner', 'ac mistri', 'ac mistry', 'ac fit', 'ac kharab', 'ac link'],
  'Electrician':   ['electric', 'bijli', 'wiring', 'short circuit', 'light', 'fan', 'بجلی', 'الیکٹریشن', 'socket', 'electrician', 'power', 'bijly', 'switch', 'board', 'pankha', 'short-circuit', 'bijli wala', 'bijliwala', 'alectrician', 'electration', 'electrecian', 'bulb', 'fuse', 'generator'],
  'Plumber':       ['plumber', 'pipe', 'leak', 'pani', 'water', 'tap', 'drain', 'nal', 'toti', 'پلمبر', 'پانی', 'ٹوٹی', 'toilet', 'flush', 'plamber', 'plumber wala', 'leakage', 'nalka', 'nalwala', 'paani', 'sewerage', 'toti kharab', 'sink', 'basin', 'shower', 'washroom leak'],
  'Carpenter':     ['carpenter', 'barhai', 'wood', 'door', 'furniture', 'shelf', 'بڑھئی', 'لکڑی', 'almaari', 'table', 'chair repair', 'carpanter', 'karpanter', 'darwaza', 'darwaza kharab', 'kabaad', 'lakri', 'sofa', 'cabinet', 'locks', 'latch', 'shutter'],
  'Painter':       ['painter', 'paint', 'rang', 'wall', 'رنگ', 'دیوار', 'painting', 'whitewash', 'distemper', 'color', 'rang wala', 'penter', 'wall paint', 'deewar rang'],
  'Car Mechanic':  ['mechanic', 'car', 'gaari', 'vehicle', 'engine', 'مکینک', 'گاڑی', 'auto', 'repair car', 'oil change', 'gaari kharab', 'gari', 'mistry', 'mistri', 'car repair', 'car mistry', 'machanic', 'mecanic', 'meccanic'],
  'Bike Mechanic': ['bike', 'motorcycle', 'motorbike', 'موٹر سائیکل', 'cycle', 'scooter', 'motar bike', 'motor bike', 'bike repair', 'bike kharab', 'bike engine'],
  'Tyre Repair':   ['tyre', 'tire', 'puncture', 'wheel', 'ٹائر', 'پنکچر', 'flat tyre', 'puncture wala', 'pahnchar', 'panchar', 'tayar', 'tyer', 'hawa', 'tube'],
  'Medical Store': ['medical', 'medicine', 'pharmacy', 'dawai', 'دوا', 'میڈیکل', 'store', 'chemist', 'tablet', 'injection', 'medical store', 'dawaai', 'pharmacy store', 'goli', 'capsule', 'dawa'],
  'Grocery':       ['grocery', 'kiryana', 'ration', 'کرانہ', 'سبزی', 'sabzi', 'vegetables', 'market', 'shop', 'karyana', 'grosry', 'sauda', 'atta', 'cheeni', 'fruits', 'doodh'],
  'Laundry':       ['laundry', 'dhobhi', 'wash', 'dhobi', 'کپڑے', 'ironing', 'press', 'dry clean', 'istri', 'kapray dhone', 'kapre dhona', 'laundri', 'dhobee'],
  'Cook / Chef':   ['cook', 'chef', 'khana', 'کھانا', 'food', 'cooking', 'meal', 'bawarchi', 'باورچی', 'khaana', 'pakanay', 'roti', 'salan', 'briyani', 'biryani'],
  'Maid / Cleaner':['maid', 'cleaner', 'clean', 'sweep', 'صفائی', 'safai', 'jhadu', 'house help', 'kaam wali', 'kaamwali', 'safai wali', 'pochha', 'dusting', 'mop'],
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
  let normalizedText = text.toLowerCase()
    .replace(/\bthirteen\b/g, '13')
    .replace(/\btwelve\b/g, '12')
    .replace(/\beleven\b/g, '11')
    .replace(/\bten\b/g, '10')
    .replace(/\bnine\b/g, '9')
    .replace(/\beight\b/g, '8')
    .replace(/\bseven\b/g, '7')
    .replace(/\bsix\b/g, '6')
    .replace(/\bfive\b/g, '5')
    .replace(/\bfour\b/g, '4')
    .replace(/\bthree\b/g, '3')
    .replace(/\btwwo\b|\btwo\b/g, '2')
    .replace(/\bone\b/g, '1')
    .replace(/تیرہ/g, '13')
    .replace(/بارہ/g, '12')
    .replace(/گیارہ/g, '11')
    .replace(/دس/g, '10');

  // Match sector letters (G, F, I, H) followed by standard numbers
  let match = normalizedText.match(/([gfi])[-\s]?(\d+)/i);
  if (match) {
    const letter = match[1].toUpperCase();
    const number = match[2];
    return `${letter}-${number}, Islamabad`;
  }

  for (const pattern of LOCATION_PATTERNS) {
    const m = normalizedText.match(pattern);
    if (m) return m[0].charAt(0).toUpperCase() + m[0].slice(1).toLowerCase();
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

// ─── GEMINI AI EXTRACTION ──────────────────────────────────────────────
const GEMINI_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    service:        { type: 'string', description: 'Canonical service name: AC Technician, Electrician, Plumber, Carpenter, Painter, Car Mechanic, Bike Mechanic, Tyre Repair, Medical Store, Grocery, Laundry, Cook / Chef, Maid / Cleaner, or Unknown if unclear.' },
    location:       { type: 'string', description: 'Location in Pakistan (e.g. "G-13, Islamabad", "F-11, Islamabad", or city name). Use "Islamabad" if no specific area mentioned.' },
    urgency:        { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    timePreference: { type: 'string', enum: ['NOW', 'TODAY', 'TOMORROW', 'MORNING', 'EVENING'] },
    language:       { type: 'string', enum: ['ENGLISH', 'ROMAN_URDU', 'URDU_SCRIPT'] },
    exactTimeProvided: { type: 'boolean', description: 'True only if user specified a specific time (morning/evening/9am etc.)' },
    confidence:     { type: 'number', description: 'Overall extraction confidence 0-100' },
  },
  required: ['service', 'location', 'urgency', 'timePreference', 'language', 'confidence'],
};

async function extractWithGemini(userText) {
  const prompt = `You are an intent extraction agent for "Fixr", a Pakistani local services booking app.
Users speak in English, Roman Urdu, or Urdu Script.

Extract the structured intent from this user message:
"${userText}"

Rules:
- Canonical service names ONLY (e.g. "AC Technician" not "ac wala")
- Map Urdu/Roman Urdu terms to canonical English (bijli=Electrician, nal/toti/pani=Plumber, thanda/AC=AC Technician, mistri+car=Car Mechanic, etc.)
- Locations: "G-13" → "G-13, Islamabad". Default to "Islamabad" if no area mentioned.
- urgency: HIGH if user says "urgent/jaldi/emergency/abhi/foran". LOW if "tomorrow/kal". MEDIUM otherwise.
- language: detect whether user typed English, Roman Urdu (latin chars but Urdu words), or Urdu script.
- confidence: 90+ if service+location both clear, 60-89 if one ambiguous, <60 if very unclear.

Return ONLY valid JSON matching the schema.`;

  return await geminiService.generateJson(prompt, GEMINI_INTENT_SCHEMA);
}

/**
 * Main export — called by Orchestrator
 * @param {string} userText - raw input
 * @param {object} state - conversational state
 * @returns {object} IntentResult with trace
 */
async function run(userText, state = {}) {
  const startTime = Date.now();
  const lowerText = userText.toLowerCase();
  let reasoning = [];
  
  // ─── STATE-BASED CONVERSATIONAL LOGIC ───
  if (state.pendingQuestion === 'TIME') {
    reasoning.push(`Context matched: Waiting for TIME clarification.`);
    reasoning.push(`Extracted explicit time: "${userText}"`);
    return {
      agent: 'Intent Agent',
      status: 'SUCCESS',
      processingMs: Date.now() - startTime,
      input: userText,
      output: {
         ...(state.intent || {}),
         timePreference: userText,
         exactTimeProvided: true,
         action: 'TIME_PROVIDED'
      },
      reasoning
    };
  }

  if (state.pendingConfirmation === true) {
    reasoning.push(`Context matched: Waiting for Booking/Call/WhatsApp confirmation.`);
    const confirmationKeywords = [
      'yes', 'haan', 'sure', 'kardo', 'book', 'theek', 'ok', 'agree', 'karlo',
      'call', 'dial', 'phone', 'baat', 'mila', 'rabta', 'contact', 'milwao',
      'whatsapp', 'chat', 'message', 'msg', 'text', 'instead', 'bajaye'
    ];
    
    if (confirmationKeywords.some(kw => lowerText.includes(kw))) {
      reasoning.push(`User confirmed action: "${userText}"`);
      
      let confirmedAction = 'CONFIRM_BOOKING';
      const hasCall = (lowerText.includes('call') || lowerText.includes('dial') || lowerText.includes('phone') || lowerText.includes('baat') || lowerText.includes('mila') || lowerText.includes('rabta') || lowerText.includes('contact') || lowerText.includes('milwao'));
      const hasChat = (lowerText.includes('whatsapp') || lowerText.includes('chat') || lowerText.includes('message') || lowerText.includes('msg') || lowerText.includes('text'));
      const hasBook = (lowerText.includes('book') || lowerText.includes('kardo') || lowerText.includes('karlo') || lowerText.includes('yes') || lowerText.includes('haan') || lowerText.includes('agree'));

      if (hasCall && hasChat) {
         // Transition phrase: e.g. "call ke bajaye WhatsApp"
         // If "whatsapp" or "chat" comes after "call", then WhatsApp is the target.
         const idxCall = Math.min(
            lowerText.includes('call') ? lowerText.indexOf('call') : Infinity,
            lowerText.includes('phone') ? lowerText.indexOf('phone') : Infinity
         );
         const idxChat = Math.min(
            lowerText.includes('whatsapp') ? lowerText.indexOf('whatsapp') : Infinity,
            lowerText.includes('chat') ? lowerText.indexOf('chat') : Infinity
         );
         if (idxChat > idxCall) {
            confirmedAction = 'CONFIRM_CHAT';
         } else {
            confirmedAction = 'CONFIRM_CALL';
         }
      } else if (hasChat) {
         confirmedAction = 'CONFIRM_CHAT';
      } else if (hasCall) {
         confirmedAction = 'CONFIRM_CALL';
      } else if (hasBook) {
         confirmedAction = 'CONFIRM_BOOKING';
      }
      
      return {
        agent: 'Intent Agent',
        status: 'SUCCESS',
        processingMs: Date.now() - startTime,
        input: userText,
        output: {
           ...(state.intent || {}),
           action: confirmedAction
        },
        reasoning
      };
    } else {
      reasoning.push(`User did not confirm. Parsing as new intent.`);
    }
  }


  // ─── STEP 1: TRY GEMINI AI EXTRACTION (Primary) ───
  if (geminiService.isReady()) {
    try {
      const geminiOut = await extractWithGemini(userText);
      reasoning.push(`🤖 Gemini AI extraction succeeded`);
      reasoning.push(`Language: ${geminiOut.language}`);
      reasoning.push(`Service identified: "${geminiOut.service}"`);
      reasoning.push(`Location extracted: "${geminiOut.location}"`);
      reasoning.push(`Urgency: ${geminiOut.urgency} | Time: ${geminiOut.timePreference}`);
      reasoning.push(`Gemini confidence: ${geminiOut.confidence}%`);

      // Build the voice summary in detected language
      const dispSvc = geminiOut.service || 'a service provider';
      const dispLoc = geminiOut.location || 'your area';
      let voiceSummary;
      if (geminiOut.language === 'ROMAN_URDU') {
        voiceSummary = `Theek hai! Fixr pe aapka swagat hai. Aap ko ${dispLoc} mein ${dispSvc} chahiye, main abhi aapke liye best options dhundh raha hun.`;
      } else if (geminiOut.language === 'URDU_SCRIPT') {
        voiceSummary = `ٹھیک ہے! فکسر پر آپ کو خوش آمدید۔ آپ کو ${dispLoc} میں ${dispSvc} چاہیے، میں ابھی آپ کے لیے بہترین آپشنز تلاش کر رہا ہوں۔`;
      } else {
        voiceSummary = `Got it! Welcome to Fixr. You need ${dispSvc} in ${dispLoc}, let me find the best options near you right away.`;
      }

      return {
        agent: 'Intent Agent',
        status: geminiOut.confidence >= 60 ? 'SUCCESS' : 'PARTIAL',
        processingMs: Date.now() - startTime,
        input: userText,
        output: {
          service:           geminiOut.service || 'Unknown',
          location:          geminiOut.location || 'Islamabad',
          urgency:           geminiOut.urgency,
          timePreference:    geminiOut.timePreference,
          exactTimeProvided: geminiOut.exactTimeProvided || false,
          language:          geminiOut.language,
          confidence:        geminiOut.confidence,
          assumptions:       [],
          voiceSummary,
          action:            'NEW_INTENT',
          source:            'gemini-1.5-flash',
        },
        reasoning,
      };
    } catch (err) {
      reasoning.push(`⚠️ Gemini extraction failed: ${err.message || err}. Falling back to keyword matcher.`);
    }
  } else {
    reasoning.push(`ℹ️ Gemini not configured — using keyword matcher`);
  }

  // ─── STEP 2: KEYWORD MATCHING FALLBACK ───

  // 1. Language Detection & Reasoning
  const language = detectLanguage(userText);
  let langReason = "";
  if (language === 'ROMAN_URDU') {
    langReason = "Roman Urdu detected — keywords: 'chahiye', 'mujhe' found";
  } else if (language === 'URDU_SCRIPT') {
    langReason = "Urdu Script detected — Arabic/Urdu characters found";
  } else {
    langReason = "English detected — fallback language";
  }

  const { service, confidence: svcConf } = detectService(userText);
  let location = detectLocation(userText);
  const urgency  = detectUrgency(userText);
  const timePref = detectTimePreference(userText);

  let assumptions = [];
  // Preserve any "Gemini failed / not configured" messages, then append keyword reasoning
  reasoning.push(langReason);

  // 2. Ambiguity Detection
  if (!service) {
    reasoning.push("Service unclear — waiting for user clarification");
  } else {
    reasoning.push(`Service identified: "${service}"`);
    if (userText.toLowerCase().includes('bijli') && service === 'Electrician') {
      reasoning.push("'bijli' maps to Electrician — highest probability match");
    }
  }

  if (!location) {
    reasoning.push("Location not specified — assuming default location (Islamabad)");
    assumptions.push("Defaulted location to Islamabad");
    location = 'Islamabad'; // ensure fallback
  } else if (['islamabad', 'rawalpindi', 'karachi', 'lahore', 'peshawar'].includes(location.toLowerCase())) {
    reasoning.push("Location is city-level only — will search all sectors");
    assumptions.push(`Broad city search for ${location}`);
  } else {
    reasoning.push(`Location extracted: "${location}"`);
  }

  // Time Ambiguity
  const hasTimeKw = Object.values(TIME_PATTERNS).flat().some(kw => lowerText.includes(kw));
  const exactTimePatterns = ['subah', 'sham', 'baje', 'am', 'pm', 'evening', 'morning', 'tonight', 'aaj raat'];
  const hasExactTime = exactTimePatterns.some(kw => lowerText.includes(kw));
  
  if (!hasTimeKw) {
    reasoning.push("Time not specified — assuming as soon as possible");
    assumptions.push("Time defaulted to ASAP");
  } else {
    reasoning.push(`Time preference: ${timePref}`);
  }

  // 3. Confidence Score Calculation
  let overallConf = 0;
  let confMath = [];
  if (service) { overallConf += 40; confMath.push("Service clear = +40%"); }
  if (location) { overallConf += 30; confMath.push("Location clear = +30%"); }
  if (hasTimeKw) { overallConf += 20; confMath.push("Time clear = +20%"); }
  if (language) { overallConf += 10; confMath.push("Language clear = +10%"); }

  reasoning.push(`Confidence Calculation: ${confMath.join(', ')}`);
  reasoning.push(`Overall intent confidence: ${overallConf}%`);

  // 5. Voice Summary Generation
  let voiceSummary = "";
  const displayService = service || "a service provider";
  const displayLocation = location || "your area";

  if (language === 'ROMAN_URDU') {
    voiceSummary = `Theek hai! Fixr pe aapka swagat hai. Aap ko ${displayLocation} mein ${displayService} chahiye, main abhi aapke liye best options dhundh raha hun.`;
  } else if (language === 'URDU_SCRIPT') {
    voiceSummary = `ٹھیک ہے! فکسر پر آپ کو خوش آمدید۔ آپ کو ${displayLocation} میں ${displayService} چاہیے، میں ابھی آپ کے لیے بہترین آپشنز تلاش کر رہا ہوں۔`;
  } else {
    voiceSummary = `Got it! Welcome to Fixr. You need ${displayService} in ${displayLocation}, let me find the best options near you right away.`;
  }

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
      exactTimeProvided: hasExactTime,
      language,
      confidence:     overallConf,
      assumptions:    assumptions,
      voiceSummary:   voiceSummary,
      action:         'NEW_INTENT'
    },
    reasoning,
  };
}

module.exports = { run };
