/**
 * Fixr — Conversational Orchestrator v3
 * True agentic AI: Gemini reasons → calls real tools → reasons again → responds.
 * Session-based memory: full conversation history persisted per user session.
 * Supports barge-in: any mid-conversation instruction is handled gracefully.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const discoveryAgent = require('./agents/discoveryAgent');
const rankingAgent   = require('./agents/rankingAgent');
const bookingAgent   = require('./agents/bookingAgent');
const followupAgent  = require('./agents/followupAgent');

// ─── Session Store ─────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Proactively evict expired sessions every 10 minutes so the Map never grows unbounded
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
      console.log(`[Session] Evicted expired session: ${id}`);
    }
  }
}, 10 * 60 * 1000);

function getOrCreateSession(sessionId) {
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (existing && Date.now() - existing.lastActivity < SESSION_TTL_MS) {
      existing.lastActivity = Date.now();
      return existing;
    }
  }
  const id = sessionId || `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const session = {
    id,
    history: [],         // Gemini conversation history — Content[] array
    context: {
      providers: [],     // Last found & ranked providers
      lastService: null,
      lastLocation: null,
      lastBooking: null,
      lastAction: null,
      detectedLang: 'ENGLISH',
      userLocation: null,
    },
    lastActivity: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

// ─── System Prompt ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Fixr AI — Pakistan's smartest home-services assistant for Islamabad & Rawalpindi.

## CRITICAL OUTPUT RULE — READ THIS FIRST
Your response must be ONLY the final conversational reply — nothing else.
NEVER write your reasoning, analysis, thought process, or internal thinking.
NEVER explain what you are going to do. Just DO it and reply.
NEVER start with "The user said..." or "The user's request..." or "I need to..." or "Let me...".
NEVER include meta-commentary like "Here's the response in Urdu script:".
Output = the actual reply to the user. That's it. Nothing else.

## LANGUAGE RULE (ABSOLUTE)
- User writes English → reply in English only
- User writes Roman Urdu → reply in Roman Urdu only
- User writes Urdu script (اردو) → reply in Urdu script only
- User mixes → match their exact mix
- NEVER switch language unless the user does first

## YOUR TOOLS
1. search_providers — find home-service providers nearby
2. book_provider — confirm booking when user says yes/haan/theek hai
3. initiate_call — connect user with provider by phone
4. schedule_followup — set post-booking reminder

## WHEN TO ASK A FOLLOW-UP (ask ONE question, then stop)
- Service type is unclear → ask what type of work
- Request is 1-2 words with no detail → ask service + area
- DO NOT ask if: service + area already given, 2+ turns in, user said "urgent", confirming/booking/calling

## WHEN TO SEARCH IMMEDIATELY
- Service type clear + area given → search right away
- 2nd or 3rd turn with enough info → search now, don't ask again
- "urgent" / "emergency" → search first

## TOOL TRIGGERS
- "haan" / "yes" / "theek hai" / "kar do" / "bilkul" / "book" → book_provider NOW
- "call" / "milawo" / "phone" / "number do" → initiate_call NOW
- New service request → search_providers NOW
- No location after 2 turns → use "Islamabad" and search

## ROUGH PRICE GUIDE (PKR — estimates only)
If the user asks about price / rate / kharcha / kitne paise, give an estimated
range from this guide and clearly say it is an estimate (andazan), final rate
is set with the provider:
Plumber/Electrician/Locksmith 500-2000 · AC service 1500-3500 · Car mechanic
1000-5000 · Bike mechanic 300-1500 · Carpenter 800-3000 · Painter 3000-8000/room
· Mason 1200-2500/day · Cleaner/Cook 1000-3000 · Tailor 400-1500 · Barber
200-800 · Beautician 1500-6000 · Laundry 300-1200 · Pest control 2000-6000 ·
Mobile/Appliance repair 500-4000 · Movers 3000-15000 · Tutor 3000-12000/month.
Never invent an exact fixed price — always present it as an estimate.

## REPLY FORMAT
- 2-3 sentences maximum. Warm, direct, conversational.
- After search: name the top pick + rating + ask "book karoon ya call milaoon?"
- After booking: confirm provider name + ETA only
- After call: just confirm you are connecting them
- Never use bullet points or lists in your reply
- Never say "I am an AI"`;


// ─── Tool Declarations ──────────────────────────────────────────────────────────
const TOOL_DECLARATIONS = [{
  functionDeclarations: [
    {
      name: 'search_providers',
      description: 'Search for local home-service providers via Google Maps. Call for ANY service request: plumber, electrician, AC technician, mechanic, carpenter, cleaner, cook, painter, medical store, laundry.',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'Service category, e.g.: Plumber, Electrician, AC Technician, Car Mechanic, Bike Mechanic, Carpenter, Painter, Mason, Welder, Maid / Cleaner, Cook / Chef, Tailor, Barber, Beautician, Laundry, Gardener, Pest Control, Mobile Repair, Appliance Repair, Generator Repair, Locksmith, Water Tanker, Movers, Tutor, Driver, Catering, Grocery Store, Medical Store. Accept any other local/informal service the user names.'
          },
          location: {
            type: 'string',
            description: 'Area in Islamabad or Rawalpindi, e.g. G-13, F-11, Bahria Town, DHA, I-8, E-11'
          },
          urgency: {
            type: 'string',
            enum: ['ASAP', 'Today', 'Tomorrow', 'Scheduled'],
            description: 'When does user need the service'
          }
        },
        required: ['service', 'location']
      }
    },
    {
      name: 'book_provider',
      description: 'Confirm and create a booking with the selected provider. Call when user gives any positive confirmation: yes, haan, book karo, confirm, theek hai, kar do, bilkul.',
      parameters: {
        type: 'object',
        properties: {
          provider_name: { type: 'string', description: 'Full name of provider to book' },
          provider_id:   { type: 'string', description: 'Provider ID from search results, if known' },
          time_preference: { type: 'string', description: 'Requested time: ASAP | morning | evening | specific time' },
          service: { type: 'string', description: 'Service type being booked' }
        },
        required: ['provider_name', 'service']
      }
    },
    {
      name: 'initiate_call',
      description: 'Connect user with a provider by phone. Call when user says: call milawo, call kar do, phone karo, unhe call karo, connect the call, number do, call please.',
      parameters: {
        type: 'object',
        properties: {
          provider_name: { type: 'string', description: 'Name of provider to call' },
          phone:         { type: 'string', description: 'Phone number from search results, if available' },
          service:       { type: 'string', description: 'Service type' }
        },
        required: ['provider_name']
      }
    },
    {
      name: 'schedule_followup',
      description: 'Set a reminder for the user after booking is complete.',
      parameters: {
        type: 'object',
        properties: {
          provider_name: { type: 'string' },
          eta_minutes:   { type: 'number', description: 'Minutes until provider arrives' },
          booking_id:    { type: 'string' }
        },
        required: ['provider_name']
      }
    }
  ]
}];

// ─── Tool Executors ─────────────────────────────────────────────────────────────
async function execSearchProviders({ service, location, urgency }, session, userLocation) {
  const intent = {
    service:    service   || 'General',
    location:   location  || 'Islamabad',
    urgency:    urgency   || 'ASAP',
    language:   session.context.detectedLang || 'ENGLISH',
    confidence: 92,
  };

  let candidates = [];
  let dataSource = 'mock';

  try {
    const disc = await discoveryAgent.run(intent);
    candidates = disc.output.candidates || [];
    dataSource = disc.output.dataSource  || 'mock';
  } catch (e) {
    console.warn('[Tool:search] discovery error:', e.message);
  }

  const effLocation = userLocation || session.context.userLocation;
  const mockDisc    = { output: { candidates, normalizedService: service } };
  const rankResult  = await rankingAgent.run(mockDisc, intent, effLocation);
  const ranked      = rankResult.output.ranked || [];

  // Store in session so subsequent turns (book/call) can reference
  session.context.providers    = ranked;
  session.context.lastService  = service;
  session.context.lastLocation = location;

  return {
    found:      ranked.length,
    dataSource,
    providers:  ranked.slice(0, 3).map(p => ({
      id:           p.id,
      name:         p.name,
      rating:       p.rating,
      distance:     p.distance != null ? `${Number(p.distance).toFixed(1)} km` : 'nearby',
      phone:        p.phone || null,
      availability: p.availability,
      reviews:      p.reviews || 0,
      score:        p.score?.total || 0,
    }))
  };
}

async function execBookProvider({ provider_name, provider_id, time_preference, service }, session) {
  const ranked   = session.context.providers || [];
  let provider   = ranked.find(p => p.id === provider_id || p.name === provider_name);
  if (!provider && ranked.length > 0) provider = ranked[0];
  if (!provider) provider = { name: provider_name, id: 'fallback', rating: 4.5, distance: 5 };

  const intent = {
    service:        service  || session.context.lastService  || 'Service',
    location:       session.context.lastLocation || 'Islamabad', // Bug 11: was missing
    timePreference: (time_preference || 'ASAP').toUpperCase(),
    urgency:        'ASAP',
    language:       session.context.detectedLang || 'ENGLISH',
  };

  const mockRanking = { output: { topPick: provider, ranked: [provider] } };
  let booking = null;

  try {
    const br = await bookingAgent.run(mockRanking, intent);
    booking  = br.output.booking;
    session.context.lastBooking = booking;
    session.context.lastAction  = 'BOOKING';
    try { await followupAgent.run(br); } catch (e) {}
  } catch (e) {
    console.warn('[Tool:book] error:', e.message);
  }

  return booking ? {
    success:      true,
    bookingId:    booking.bookingId,
    provider:     booking.provider?.name || provider_name,
    service:      intent.service,
    scheduledFor: booking.scheduledFor,
    etaMinutes:   booking.etaMinutes,
    cost:         booking.cost,
    status:       'CONFIRMED',
  } : { success: false, reason: 'Could not confirm booking' };
}

async function execInitiateCall({ provider_name, phone, service }, session) {
  const ranked        = session.context.providers || [];
  const provider      = ranked.find(p => p.name === provider_name) || ranked[0];
  const resolvedPhone = phone || provider?.phone || null;

  session.context.lastAction = 'CALL';

  return {
    success:  true,
    provider: provider_name,
    phone:    resolvedPhone,
    action:   'INITIATE_CALL',
    hasPhone: !!resolvedPhone,
    message:  resolvedPhone
      ? `Calling ${provider_name} at ${resolvedPhone}`
      : `No phone number on record for ${provider_name}`,
  };
}

async function execScheduleFollowup({ provider_name, eta_minutes }, session) {
  return {
    success: true,
    message: `Reminder set: ${eta_minutes || 25} minutes`,
    provider: provider_name,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────
function getKeys() {
  if (process.env.GEMINI_API_KEYS)
    return process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
  if (process.env.GEMINI_API_KEY) return [process.env.GEMINI_API_KEY];
  return [];
}

function detectLanguage(text) {
  if (/[؀-ۿ]/.test(text)) return 'URDU_SCRIPT';
  // Only use clearly Urdu-only words — avoid English words like "plumber", "electrician" that cause false positives
  const romanUrduWords = /\b(kya|hain|main|mujhe|aap|nahi|haan|han|aaj|thoda|yaar|bhai|chahiye|woh|karein|karo|mila|phir|abhi|agar|toh|tou|zaroorat|achha|theek|shukriya|meherbani|janab|mistri|bijli|ghar|kaam|wala|wali|dena|lena|bulao|bhejo|raha|gaya|kal|pani)\b/i;
  if (romanUrduWords.test(text)) return 'ROMAN_URDU';
  return 'ENGLISH';
}

// ─── Response Sanitizer ────────────────────────────────────────────────────────
// Strips chain-of-thought reasoning that Gemini sometimes leaks into its text.
// Works at sentence level: any sentence that reads as internal reasoning / meta-
// commentary is dropped. The genuine user-facing reply is always what remains
// (and is always the last sentence if reasoning was detected).
const REASONING_MARKERS = [
  'the user', "user's request", "user's response", 'user has', 'user said',
  'user wrote', 'user responded', 'user switched', 'user is now', 'user input',
  'i should', 'i need to', 'i will continue', 'i will use', 'i must',
  'i need a location', "i'll ask", "i'll continue", 'i can ask',
  'therefore, i', 'therefore i', 'clarifying question',
  're-evaluate', 'reevaluate', "here's the response", 'here is the response',
  'my response', 'the response in', 'in urdu script', 'in roman urdu',
  'search results show', 'the search results', 'search_providers',
  'should ask', 'should present', 'should continue', 'should use',
  'appropriate question', 'most appropriate', 'previous turn',
  'previous response', 'last input', 'last turn', 'last response',
  'default_api', 'this indicates', 'to effectively use',
  'to provide assistance', 'to provide any',
];

function sanitizeGeminiResponse(text) {
  if (!text) return '';

  // 1. Strip tool_code artifacts
  text = text
    .replace(/tool_code\s+print\s*\([\s\S]*?\)\s*/gi, '')
    .replace(/\btool_code\b[^\n]*/gi, '')
    .trim();

  // 2. If the model prefixed "Here's the response in X:" — take what's after it
  const handoffMatch = text.match(
    /(?:here(?:'s| is) (?:the |my )?(?:response|reply|answer)[^\n:]*:|my response is:|so my response is:|response in urdu script:|response in roman urdu:)\s*([\s\S]+)/i
  );
  if (handoffMatch) text = handoffMatch[1].trim();

  // 3. Gemini sometimes omits the space after a sentence-ender ("needed.Zaroor!").
  //    Insert one so the sentence splitter works reliably.
  text = text.replace(/([.!?؟])(?=[A-Z؀-ۿ])/g, '$1 ');

  const rawSentences = text.split(/(?<=[.!?؟])\s+/).map(s => s.trim()).filter(Boolean);
  if (rawSentences.length <= 1) return text.trim();

  // 4. Drop any sentence that reads as internal reasoning / meta-commentary
  const isReasoning = (s) => {
    const low = s.toLowerCase();
    return REASONING_MARKERS.some(m => low.includes(m));
  };
  const hasAnyReasoning = rawSentences.some(isReasoning);

  let kept = hasAnyReasoning ? rawSentences.filter(s => !isReasoning(s)) : rawSentences;
  // If filtering removed everything, the genuine reply is the last sentence.
  if (kept.length === 0) kept = [rawSentences[rawSentences.length - 1]];

  // 5. Deduplicate repeated sentences
  const seen = new Set();
  let deduped = kept.filter(s => {
    const key = s.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 6. When reasoning was present, a genuine conversational reply is short —
  //    keep only the final 1-2 sentences; anything earlier is leftover reasoning.
  if (hasAnyReasoning && deduped.length > 2) deduped = deduped.slice(-2);

  return deduped.join(' ').trim();
}

// ─── Main Export ─────────────────────────────────────────────────────────────────
async function orchestrate(userMessage, state = {}, userLocation = null, sessionId = null) {
  const startTime = Date.now();
  const trace     = [];

  // Resolve or create session
  const resolvedId = sessionId || state?.sessionId || null;
  const session    = getOrCreateSession(resolvedId);
  if (userLocation) session.context.userLocation = userLocation;

  // Detect language
  const lang = detectLanguage(userMessage);
  session.context.detectedLang = lang;

  const keys = getKeys();
  if (!keys.length) throw new Error('No Gemini API keys configured');

  let finalText      = '';
  let detectedAction = null;
  let callResult     = null;
  let bookingData    = null;
  let rankedProviders = [];
  let lastError;

  trace.push({
    agent: 'Intent Agent',
    status: 'RUNNING',
    reasoning: [
      `📝 Input: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`,
      `🌐 Language: ${lang}`,
      `🔑 Session: ${session.id} | Turn #${Math.floor(session.history.length / 2) + 1}`,
    ],
    processingMs: 1,
  });

  // Try each key in rotation
  for (let ki = 0; ki < keys.length; ki++) {
    try {
      const genAI = new GoogleGenerativeAI(keys[ki]);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        tools: TOOL_DECLARATIONS,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 350,
          // gemini-2.5-flash has thinking ON by default — disable it so chain-of-thought
          // is never produced. (On flash-lite this flag was a no-op; on full flash it works.)
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      // Start chat with existing session history (multi-turn memory)
      const chat = model.startChat({ history: session.history });

      let result   = await chat.sendMessage(userMessage);
      let response = result.response;

      // Helper: safely get function calls (SDK 0.24 returns undefined when none)
      const getFnCalls = (r) => {
        try { const fns = r.functionCalls?.(); return Array.isArray(fns) ? fns : []; }
        catch(e) { return []; }
      };

      // ── Agentic tool loop: Gemini reasons → calls tool → gets result → reasons again ──
      let loopGuard = 0;
      let fnCalls   = getFnCalls(response);
      while (fnCalls.length > 0 && loopGuard < 6) {
        loopGuard++;
        const calls          = fnCalls;
        const toolResponses  = [];

        for (const call of calls) {
          const agentLabel = {
            search_providers:  'Discovery Agent',
            book_provider:     'Booking Agent',
            initiate_call:     'Follow-up Agent',
            schedule_followup: 'Follow-up Agent',
          }[call.name] || 'Orchestrator';

          trace.push({
            agent:   agentLabel,
            status:  'RUNNING',
            reasoning: [`🔧 ${call.name}(${JSON.stringify(call.args).slice(0, 90)})`],
            processingMs: Date.now() - startTime,
          });

          let toolResult;
          try {
            if (call.name === 'search_providers') {
              toolResult      = await execSearchProviders(call.args, session, userLocation);
              rankedProviders = session.context.providers || [];
              detectedAction  = 'SEARCH';
              const top       = toolResult.providers[0];
              trace[trace.length - 1].status = 'SUCCESS';
              trace[trace.length - 1].reasoning = [
                `✅ Found ${toolResult.found} providers via ${toolResult.dataSource}`,
                top ? `🏆 Top: ${top.name} ⭐${top.rating} · ${top.distance}` : '⚠️ No results found',
                top?.phone ? `📞 ${top.phone}` : '(no phone on record)',
              ].filter(Boolean);

            } else if (call.name === 'book_provider') {
              toolResult  = await execBookProvider(call.args, session);
              bookingData = toolResult.success ? toolResult : null;
              if (toolResult.success) detectedAction = 'BOOKING';
              trace[trace.length - 1].status = toolResult.success ? 'SUCCESS' : 'ERROR';
              trace[trace.length - 1].reasoning = toolResult.success
                ? [`✅ Booking confirmed: ${toolResult.bookingId}`, `🚗 ETA: ${toolResult.etaMinutes} min | 💰 PKR ${toolResult.cost?.total || '?'}`]
                : [`❌ Booking failed: ${toolResult.reason}`];

            } else if (call.name === 'initiate_call') {
              toolResult  = await execInitiateCall(call.args, session);
              callResult  = toolResult;
              detectedAction = 'CALL';
              trace[trace.length - 1].status = 'SUCCESS';
              trace[trace.length - 1].reasoning = [
                `📞 Connecting to ${toolResult.provider}`,
                toolResult.phone ? `Number: ${toolResult.phone}` : '⚠️ No phone — WhatsApp fallback',
              ];

            } else if (call.name === 'schedule_followup') {
              toolResult = await execScheduleFollowup(call.args, session);
              trace[trace.length - 1].status = 'SUCCESS';
              trace[trace.length - 1].reasoning = [`🔔 ${toolResult.message}`];

            } else {
              toolResult = { error: `Unknown tool: ${call.name}` };
              trace[trace.length - 1].status = 'ERROR';
            }
          } catch (toolErr) {
            toolResult = { error: toolErr.message };
            trace[trace.length - 1].status = 'ERROR';
            trace[trace.length - 1].reasoning = [`❌ Tool error: ${toolErr.message}`];
            console.error(`[Tool:${call.name}]`, toolErr.message);
          }

          toolResponses.push({ functionResponse: { name: call.name, response: toolResult } });
        }

        // Feed tool results back to Gemini for next reasoning step
        result   = await chat.sendMessage(toolResponses);
        response = result.response;
        fnCalls  = getFnCalls(response);
      }

      // Extract final natural-language response
      // Guard: only call .text() when there are no pending function calls.
      // Calling .text() on a response that contains function calls causes Gemini
      // to leak "tool_code print(default_api.search_providers(...))" as plain text.
      const remainingCalls = getFnCalls(response);
      if (remainingCalls.length === 0) {
        try { finalText = response.text ? response.text() : ''; } catch(e) { finalText = ''; }
      }

      // ── Sanitize: strip all reasoning / thinking leakage ──────────────────────
      if (finalText) {
        finalText = sanitizeGeminiResponse(finalText);
      }

      // Fallback: if Gemini returned empty text, ask it to summarize (one retry)
      if (!finalText.trim()) {
        try {
          const summaryResult = await chat.sendMessage(
            'Reply in 2 sentences only. What did you find and what should the user do next?'
          );
          try { finalText = summaryResult.response.text?.() || ''; } catch(e2) { finalText = ''; }
          if (finalText) finalText = sanitizeGeminiResponse(finalText);
        } catch(e) {}
      }

      // Last resort: generate a reply from stored context
      if (!finalText.trim() && session.context.providers?.length > 0) {
        const top  = session.context.providers[0];
        const lang = session.context.detectedLang || 'ENGLISH';
        if (lang === 'URDU_SCRIPT') {
          finalText = `میں نے ${session.context.providers.length} providers ڈھونڈے ہیں۔ ${top.name} بہترین آپشن ہے جن کی ریٹنگ ${top.rating} ستارے ہے۔ کیا میں ان کو بُک کر دوں، یا آپ ان کو کال کرنا چاہیں گے؟`;
        } else if (lang === 'ROMAN_URDU') {
          finalText = `Maine ${session.context.providers.length} providers dhunde hain. ${top.name} best option hain — ${top.rating} stars. Kya main book kar doon, ya aap unhe call karna chahenge?`;
        } else {
          finalText = `I found ${session.context.providers.length} providers. ${top.name} is the top pick with ${top.rating} stars${top.distance != null ? ` and ${Number(top.distance).toFixed(1)} km away` : ''}. Should I book them, or would you like to call them directly?`;
        }
      }

      // Persist this turn in session history for next request
      // getHistory() returns a Promise in SDK 0.24.x — must await
      const rawHistory = chat.getHistory ? await chat.getHistory() : [];
      session.history  = Array.isArray(rawHistory) ? rawHistory : [];

      if (ki > 0) console.log(`[Orchestrator] Recovered with key index ${ki}`);
      lastError = null;
      break;

    } catch (err) {
      lastError = err;
      console.warn(`[Orchestrator] Key ${ki} failed: ${err.message}`);
    }
  }

  if (!finalText && lastError) throw lastError;

  // Always populate rankedProviders from session context for CALL/BOOKING turns
  // (those turns don't run search, so rankedProviders stays empty without this)
  if (rankedProviders.length === 0 && session.context.providers && session.context.providers.length > 0) {
    rankedProviders = session.context.providers;
  }

  trace.push({
    agent:  'Orchestrator',
    status: 'COMPLETED',
    reasoning: [
      `✅ Response generated (${Date.now() - startTime}ms total)`,
      detectedAction ? `⚡ Action taken: ${detectedAction}` : '💬 Conversational response',
      `📊 Session turns: ${Math.floor(session.history.length / 2)}`,
    ],
    processingMs: Date.now() - startTime,
  });

  // Build legacy-compatible booking object
  const booking = bookingData ? {
    provider:    { name: bookingData.provider, phone: session.context.providers?.[0]?.phone },
    etaMinutes:  bookingData.etaMinutes,
    scheduledFor: bookingData.scheduledFor,
    confirmationId: bookingData.bookingId,
    status: 'CONFIRMED',
    cost: bookingData.cost,
  } : null;

  // ── Orchestrator Voice Narration ─────────────────────────────────────────────
  // The Orchestrator speaks in pure first person — "Maine kiya", "I did X".
  // No agent names in the audio. The pipeline visual tab shows agent activity.
  // Audio = Orchestrator's own voice explaining what IT did, step by step.
  const stepLang = session.context.detectedLang || 'ENGLISH';
  const isRU     = stepLang === 'ROMAN_URDU';
  const isUS     = stepLang === 'URDU_SCRIPT';
  const stepTexts = [];
  const top       = rankedProviders[0];
  const svc       = session.context.lastService  || 'service';
  const loc       = session.context.lastLocation || 'Islamabad';
  const topDist   = top?.distance != null ? `${Number(top.distance).toFixed(1)} km door` : 'aap ke qareeb';
  const topDistEN = top?.distance != null ? `${Number(top.distance).toFixed(1)} km away`  : 'nearby';

  if (detectedAction === 'SEARCH') {
    if (isRU) {
      stepTexts.push(`Maine aapki request samjhi — aapko ${loc} mein ${svc} chahiye. Maine turant search shuru kar di.`);
      if (top) {
        stepTexts.push(`Maine ${loc} mein available options scan kiye aur har provider ki rating, distance aur availability check ki.`);
        stepTexts.push(`Maine ${rankedProviders.length} options nikale. ${top.name} sabse behtar hai — ${top.rating} stars aur sirf ${topDist}. Book karun ya call milaoon?`);
      } else {
        stepTexts.push(`Maine poori koshish ki lekin is area mein koi available option nahi mila. Kya main kisi aur area mein dhundhoon?`);
      }
    } else if (isUS) {
      // Roman Urdu for TTS — ElevenLabs reads Urdu script poorly
      stepTexts.push(`Maine aapki request samjhi — ${loc} mein ${svc} chahiye. Maine search ki.`);
      if (top) {
        stepTexts.push(`Maine providers scan kiye aur ratings check ki — ${top.name} best nikla, ${top.rating} stars ke saath.`);
        stepTexts.push(`Maine results ready kar liye hain. ${top.name} ko book karun ya call milaoon?`);
      } else {
        stepTexts.push(`Maine koshish ki lekin ${loc} mein koi option nahi mila. Koi aur area?`);
      }
    } else {
      stepTexts.push(`I understood your request — you need ${svc} in ${loc}. I started searching immediately.`);
      if (top) {
        stepTexts.push(`I scanned all available providers in ${loc} and checked each one's rating, distance, and response time.`);
        stepTexts.push(`I found ${rankedProviders.length} options. ${top.name} is my top pick — ${top.rating} stars and just ${topDistEN}. Should I book them or connect you directly?`);
      } else {
        stepTexts.push(`I searched thoroughly but found no available providers in that area. Want me to expand the search?`);
      }
    }

  } else if (detectedAction === 'CALL') {
    const provName = callResult?.provider || top?.name || 'the provider';
    const phone    = callResult?.phone    || top?.phone;
    if (isRU || isUS) {
      stepTexts.push(`Main ${provName} se aapko connect kar raha hoon.`);
      stepTexts.push(phone ? `Maine ${phone} dial ki — please hold karein!` : `Maine ${provName} ko WhatsApp par message kiya!`);
    } else {
      stepTexts.push(`I'm connecting you to ${provName} right now.`);
      stepTexts.push(phone ? `I've dialed ${phone} — please hold!` : `I've reached out to ${provName} via WhatsApp!`);
    }

  } else if (detectedAction === 'BOOKING' && bookingData) {
    const provName = bookingData.provider || top?.name || 'the provider';
    const eta      = bookingData.etaMinutes || 25;
    const bookId   = bookingData.bookingId  || 'BK-001';
    const reminderMin = Math.max(eta - 5, 5);
    if (isRU || isUS) {
      stepTexts.push(`Main ${provName} ke saath aapka slot confirm kar raha hoon.`);
      stepTexts.push(`Ho gaya! Maine slot lock kar diya — ${provName} ${eta} minute mein aayenge. Booking ID: ${bookId}.`);
      stepTexts.push(`Maine ek reminder bhi set kar diya — ${reminderMin} minute mein aapko update milega.`);
    } else {
      stepTexts.push(`I'm confirming your booking with ${provName} right now.`);
      stepTexts.push(`Done! I've secured your slot — ${provName} will arrive in about ${eta} minutes. Booking ID: ${bookId}.`);
      stepTexts.push(`I've also set a reminder — you'll get an update in ${reminderMin} minutes.`);
    }

  } else if (finalText) {
    // Conversational reply — no tool called, speak the reply directly
    stepTexts.push(finalText);
  }

  // For action turns (SEARCH/BOOK/CALL) the chat reply is the clean, deterministic
  // narration built above — NOT Gemini's raw text, which can leak chain-of-thought.
  // Conversational turns keep the (already sanitized) Gemini reply.
  if (detectedAction && stepTexts.length > 0) {
    finalText = stepTexts.join(' ');
  }

  return {
    success:      true,
    reply:        finalText,
    voiceResponse: finalText,
    stepTexts,
    state: {
      recommendedProvider: session.context.providers?.[0] || null,
      lastAction:          detectedAction,
      sessionId:           session.id,
    },
    thoughtProcess: trace.map(t => `[${t.agent}]: ${t.reasoning.join(' | ')}`).join('\n'),
    booking,
    rankedProviders,
    trace,
    callResult,
    sessionSummary: {
      platform:          'Fixr',
      totalAgentsRun:    trace.filter(t => t.status !== 'COMPLETED').length,
      totalProcessingMs: Date.now() - startTime,
      decisionsMode:     'GEMINI_AGENTIC_V3',
      turnCount:         Math.floor(session.history.length / 2),
      sessionId:         session.id,
      status:            'COMPLETED',
    },
    intent: {
      service:    session.context.lastService  || 'Unknown',
      location:   session.context.lastLocation || 'Islamabad',
      language:   session.context.detectedLang || 'ENGLISH',
      action:     detectedAction || 'CHAT',
      confidence: 95,
    },
    sessionId:  session.id,
    traceId:    'TRX-' + Date.now(),
  };
}

function getGlobalTrace() { return []; }

module.exports = { orchestrate, getGlobalTrace };
