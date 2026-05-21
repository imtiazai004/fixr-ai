/**
 * Fixr — Express Server
 * Google Antigravity Hackathon — Challenge 2
 */

const path = require('path');

// IMPORTANT: Load environment variables FIRST, before any module that reads env vars at import time
// Try backend/.env (local dev), then root .env, then Vercel env vars are already in process.env
try {
    require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
} catch(e) {
    try { require('dotenv').config(); } catch(e2) { /* Vercel: env vars set in dashboard */ }
}

const express    = require('express');
const fs         = require('fs');
const cors       = require('cors');
const { orchestrate } = require('./orchestrator');
const ElevenLabsService = require('./voiceService');

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3005;

// Initialize ElevenLabs voice service — API key + Voice ID always read from env
const voiceService = new ElevenLabsService(
    process.env.ELEVENLABS_API_KEY,
    process.env.ELEVENLABS_AGENT_ID,
    process.env.ELEVENLABS_VOICE_ID
);

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: Create / resume a conversation session ──────────────────
app.post('/api/session', (req, res) => {
  const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  res.json({ sessionId });
});

// ─── API: Hackton simulated 3-agent request endpoint ────────────────
function runAgenticWorkflow(userInput, providersList) {
    const trace = [];
    const lowerText = userInput.toLowerCase();

    trace.push({
        agent: "Linguistic Agent",
        action: "Analyzing natural language intent...",
        log: "Detected input. Checking for keywords in English, Roman Urdu, and Urdu script..."
    });

    let service = 'Unknown';
    let location = 'Unknown';
    let time = 'Unknown';

    // Service detection (Expanded with Roman Urdu variations)
    if (lowerText.includes('ac') || lowerText.includes('a.c') || lowerText.includes('air conditioner') || lowerText.includes('cooling') || lowerText.includes('thanda') || lowerText.includes('ठंडा') || lowerText.includes('technician') || lowerText.includes('اے سی') || lowerText.includes('eaton')) {
        service = 'AC Technician';
    } else if (lowerText.includes('plumber') || lowerText.includes('nal') || lowerText.includes('pipe') || lowerText.includes('toti') || lowerText.includes('pani') || lowerText.includes('paani') || lowerText.includes('leakage') || lowerText.includes('پلمبر') || lowerText.includes('نل') || lowerText.includes('پانی')) {
        service = 'Plumber';
    } else if (lowerText.includes('electrician') || lowerText.includes('bijli') || lowerText.includes('electric') || lowerText.includes('bijly') || lowerText.includes('light') || lowerText.includes('bulb') || lowerText.includes('switch') || lowerText.includes('fan') || lowerText.includes('wiring') || lowerText.includes('الیکٹریشن') || lowerText.includes('بجلی')) {
        service = 'Electrician';
    } else if (lowerText.includes('mechanic') || lowerText.includes('mistri') || lowerText.includes('mistry') || lowerText.includes('gaari') || lowerText.includes('gari') || lowerText.includes('car') || lowerText.includes('bike') || lowerText.includes('vehicle') || lowerText.includes('میکینک') || lowerText.includes('گاڑی')) {
        service = 'Mechanic';
    } else if (lowerText.includes('medical') || lowerText.includes('dawa') || lowerText.includes('dawaai') || lowerText.includes('medicine') || lowerText.includes('pharmacy') || lowerText.includes('dawakhana') || lowerText.includes('میڈیکل اسٹور') || lowerText.includes('دوا')) {
        service = 'Medical Store';
    } else if (lowerText.includes('clean') || lowerText.includes('safai') || lowerText.includes('sweep') || lowerText.includes('صفائی')) {
        service = 'Cleaner';
    }

    // Location detection
    if (lowerText.includes('g-13') || lowerText.includes('g13') || lowerText.includes('جی ۱۳') || lowerText.includes('جی-۱۳')) {
        location = 'G-13';
    } else if (lowerText.includes('g-11') || lowerText.includes('g11') || lowerText.includes('جی ۱۱')) {
        location = 'G-11';
    } else if (lowerText.includes('f-11') || lowerText.includes('f11') || lowerText.includes('ایف ۱۱')) {
        location = 'F-11';
    }

    // Time detection
    if (lowerText.includes('kal') || lowerText.includes('tomorrow') || lowerText.includes('کل')) {
        time = 'Tomorrow';
    } else if (lowerText.includes('aaj') || lowerText.includes('today') || lowerText.includes('abhi') || lowerText.includes('آج') || lowerText.includes('ابھی')) {
        time = 'Today';
    } else {
        time = 'As soon as possible';
    }

    trace.push({
        agent: "Linguistic Agent",
        action: "Intent Extracted",
        result: { service, location, time }
    });

    // Agent 2: Discovery & Matching Agent
    trace.push({
        agent: "Matching Agent",
        action: "Searching for providers...",
        log: `Filtering providers for category: ${service} in area: ${location}`
    });

    let matchedProviders = providersList.filter(p => 
        p.category === service && 
        (location === 'Unknown' || p.location.includes(location))
    );

    // Rank by rating and distance
    matchedProviders.forEach(p => {
        p.score = (p.rating * 10) - (p.distance * 2);
    });
    matchedProviders.sort((a, b) => b.score - a.score);

    const selectedProvider = matchedProviders[0];

    trace.push({
        agent: "Matching Agent",
        action: "Provider Ranked",
        result: { 
            found: matchedProviders.length, 
            selected: selectedProvider ? selectedProvider.name : 'None',
            reasoning: selectedProvider ? `Selected ${selectedProvider.name} based on score ${selectedProvider.score.toFixed(1)}.` : "No direct match found."
        }
    });

    // Agent 3: Execution & Simulation Agent
    let booking = null;
    if (selectedProvider) {
        trace.push({
            agent: "Execution Agent",
            action: "Simulating booking action...",
            log: `Calling Mock Booking API for ${selectedProvider.name}...`
        });

        booking = {
            status: 'Confirmed',
            slot: '10:00 AM',
            provider: selectedProvider.name,
            message: `Booking successful with ${selectedProvider.name}. Appointment scheduled for ${time} at 10:00 AM.`
        };

        trace.push({
            agent: "Execution Agent",
            action: "Action Completed",
            result: booking
        });
        
        trace.push({
            agent: "Execution Agent",
            action: "Scheduling Follow-up",
            result: { followUp: "Reminder notification scheduled 1 hour before appointment." }
        });
    }

    return {
        trace,
        output: {
            service,
            location,
            time,
            selectedProvider,
            booking
        }
    };
}

app.post('/api/request', async (req, res) => {
  const { userInput, state, userLocation, sessionId } = req.body;
  if (!userInput) {
    return res.status(400).json({ error: 'User input is required' });
  }

  try {
    const result = await orchestrate(userInput, state || {}, userLocation || null, sessionId || null);

    // Generate progressive audio steps in parallel to keep latency extremely low!
    let stepAudios = [];
    let audioBase64 = null;
    let initAudioBase64 = null;
    let discoveryAudioBase64 = null;

    if (result.voiceResponse) {
      try {
        const finalAudioBuffer = await voiceService.generateSpeech(result.voiceResponse);
        if (finalAudioBuffer) {
          audioBase64 = finalAudioBuffer.toString('base64');
        }
      } catch (err) {
        console.warn('[Server] ElevenLabs final voice response generation failed:', err.message);
      }
    }

    if (result.stepTexts && result.stepTexts.length > 0) {
      try {
        const audioBuffers = await Promise.all(
          result.stepTexts.map(text => voiceService.generateSpeech(text))
        );
        stepAudios = audioBuffers.map(buf => buf ? buf.toString('base64') : null);
        
        // Map to legacy parameters for backward compatibility
        initAudioBase64 = stepAudios[0] || null;
        discoveryAudioBase64 = stepAudios[1] || null;
        if (!audioBase64) {
          audioBase64 = stepAudios[stepAudios.length - 1] || null;
        }
        
        console.log(`[Server] Generated ${stepAudios.length} progressive voice buffers successfully.`);
      } catch (voiceErr) {
        console.warn('[Server] ElevenLabs progressive voice generation failed/skipped:', voiceErr.message);
      }
    }

    // Construct the legacy 'output' object for full premium map/card compatibility
    const selectedProvider = result.rankedProviders && result.rankedProviders.length > 0 
        ? result.rankedProviders[0] 
        : null;

    const legacyOutput = {
      service: result.intent?.service || 'Unknown',
      location: result.intent?.location || 'Unknown',
      time: result.intent?.timePreference || 'As soon as possible',
      selectedProvider: selectedProvider,
      booking: result.booking ? {
        status: result.booking.status || 'Confirmed',
        slot: result.booking.scheduledFor || '10:00 AM',
        provider: result.booking.provider.name,
        message: result.reply
      } : null
    };

    res.json({
      success: result.success,
      reply: result.reply,
      state: result.state,
      thoughtProcess: result.thoughtProcess,
      booking: result.booking,
      rankedProviders: result.rankedProviders,
      trace: result.trace,
      sessionSummary: result.sessionSummary,
      voiceResponse: result.voiceResponse,
      stepTexts: result.stepTexts,
      stepAudios: stepAudios,
      audioBase64: audioBase64,
      initAudioBase64: initAudioBase64,
      discoveryAudioBase64: discoveryAudioBase64,
      traceId: result.traceId,
      intent: result.intent,        // ← language detection for client-side UI sync
      sessionId: result.sessionId,  // ← session continuity
      callResult: result.callResult,// ← phone call trigger data
      // Legacy wrapper
      output: legacyOutput
    });

  } catch (err) {
    console.error('[Server] Error in /api/request:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ─── API: Main orchestration endpoint ─────────────────────────
app.post('/api/chat', async (req, res) => {
  console.log(`[Server] Received chat request: "${req.body.message}"`);
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const result = await orchestrate(message.trim());
    res.json(result);
  } catch (err) {
    console.error('[Server] Error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ─── API: Get providers (for map display) ─────────────────────
app.get('/api/providers', (req, res) => {
  try {
    const providers = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'providers.json'), 'utf-8')
    );
    res.json(providers);
  } catch (err) {
    res.status(500).json({ error: 'Could not load providers' });
  }
});

// ─── API: Get trace log ───────────────────────────────────────
app.get('/api/trace', (req, res) => {
  try {
    const logPath = path.join(__dirname, 'data', 'trace.log');
    if (!fs.existsSync(logPath)) return res.json([]);
    const lines = fs.readFileSync(logPath, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-50); // last 50 entries
    res.json(lines);
  } catch (err) {
    res.status(500).json({ error: 'Could not read trace log' });
  }
});

// ─── API: Submit rating ───────────────────────────────────────
app.post('/api/rate', (req, res) => {
  const { bookingId, rating, comment } = req.body;
  console.log(`[Rating] Booking ${bookingId} rated ${rating}/5: "${comment}"`);

  const paymentMsg = rating >= 4
    ? `💚 Payment released to provider. Thank you for the great rating!`
    : `😔 Low rating noted. Support team will follow up. Payment held pending review.`;

  res.json({ success: true, message: paymentMsg, rating });
});

// ─── Serve app ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║      Fixr — Antigravity Hackathon      ║`);
  console.log(`║   Running at: http://localhost:${PORT}     ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});
