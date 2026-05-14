/**
 * ORCHESTRATOR — KhidmatAI
 * Powered by: Google Antigravity (Simulated Runtime)
 *
 * This is the central "brain" of the system.
 * It coordinates all 5 agents in sequence, manages shared AgentState,
 * builds the Antigravity Trace, and saves it to trace.log.
 *
 * In a real Antigravity deployment:
 *   - Each agent would be a registered Antigravity Tool
 *   - The orchestrator would use Antigravity's planner to route between them
 *   - Traces would be stored in Antigravity's audit log
 */

const fs   = require('fs');
const path = require('path');

const intentAgent   = require('./agents/intentAgent');
const discoveryAgent = require('./agents/discoveryAgent');
const rankingAgent  = require('./agents/rankingAgent');
const bookingAgent  = require('./agents/bookingAgent');
const followupAgent = require('./agents/followupAgent');

const TRACE_LOG_PATH = path.join(__dirname, 'data', 'trace.log');
const PROVIDERS_PATH = path.join(__dirname, 'data', 'providers.json');

let providers = [];
try {
  providers = JSON.parse(fs.readFileSync(PROVIDERS_PATH, 'utf-8'));
} catch (e) {
  console.error('[Orchestrator] Failed to load providers.json:', e.message);
}

function appendToTraceLog(entry) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(TRACE_LOG_PATH, line, 'utf-8');
  } catch (e) {
    // Non-critical — don't break execution
  }
}

/**
 * Main orchestration pipeline.
 * Runs agents sequentially, passing state between them.
 *
 * @param {string} userInput - raw user text
 * @returns {object} Full pipeline result including all agent traces
 */
async function orchestrate(userInput) {
  const pipelineStart = Date.now();
  const sessionId = `SES-${Date.now().toString(36).toUpperCase()}`;

  const trace = [];         // Antigravity Trace — all agent logs
  const state = {};         // Shared state passed between agents

  console.log(`\n[Antigravity] 🚀 Session ${sessionId} started`);
  console.log(`[Antigravity] 📝 User Input: "${userInput}"`);

  // ─── AGENT 1: Intent ───────────────────────────────────────
  console.log('[Antigravity] → Dispatching: Intent Agent');
  const intentResult = intentAgent.run(userInput);
  state.intent = intentResult.output;
  trace.push(intentResult);
  appendToTraceLog({ sessionId, agent: 1, result: intentResult });

  // ─── AGENT 2: Discovery ────────────────────────────────────
  console.log('[Antigravity] → Dispatching: Discovery Agent');
  const discoveryResult = discoveryAgent.run(state.intent, providers);
  state.discovery = discoveryResult.output;
  trace.push(discoveryResult);
  appendToTraceLog({ sessionId, agent: 2, result: discoveryResult });

  // Handle no results
  if (discoveryResult.status === 'NO_RESULTS') {
    const noResultTrace = {
      agent: 'Orchestrator',
      status: 'NO_PROVIDERS',
      reasoning: [
        `❌ Discovery Agent returned 0 results for "${state.intent.service}" in "${state.intent.location}".`,
        `📡 Antigravity planning engine: halting pipeline — no viable path forward.`,
        `💡 Suggestion: Try a different service type or broader location.`,
      ],
    };
    trace.push(noResultTrace);
    return buildResponse(sessionId, userInput, state, trace, null, pipelineStart);
  }

  // ─── AGENT 3: Ranking ──────────────────────────────────────
  console.log('[Antigravity] → Dispatching: Ranking Agent');
  const rankingResult = rankingAgent.run(discoveryResult, state.intent);
  state.ranking = rankingResult.output;
  trace.push(rankingResult);
  appendToTraceLog({ sessionId, agent: 3, result: rankingResult });

  // ─── AGENT 4: Booking ──────────────────────────────────────
  console.log('[Antigravity] → Dispatching: Booking Agent');
  const bookingResult = bookingAgent.run(rankingResult, state.intent);
  state.booking = bookingResult.output;
  trace.push(bookingResult);
  appendToTraceLog({ sessionId, agent: 4, result: bookingResult });

  // ─── AGENT 5: Follow-up ────────────────────────────────────
  console.log('[Antigravity] → Dispatching: Follow-up Agent');
  const followupResult = followupAgent.run(bookingResult);
  state.followup = followupResult.output;
  trace.push(followupResult);
  appendToTraceLog({ sessionId, agent: 5, result: followupResult });

  console.log(`[Antigravity] ✅ Pipeline complete in ${Date.now() - pipelineStart}ms`);

  return buildResponse(sessionId, userInput, state, trace, bookingResult.output.booking, pipelineStart);
}

function buildResponse(sessionId, userInput, state, trace, booking, pipelineStart) {
  const totalMs = Date.now() - pipelineStart;
  const intent  = state.intent || {};

  // Build natural language reply
  let reply;
  if (booking) {
    const p = booking.provider;
    reply = `✅ **Booking Confirmed!**\n\n` +
      `I found **${p.name}** — rated ⭐ ${p.rating}/5 with ${p.reviews || 0} reviews.\n\n` +
      `📍 **Location:** ${p.location}\n` +
      `🚗 **ETA:** ~${booking.etaMinutes} minutes\n` +
      `💰 **Cost:** PKR ${booking.cost.total} (Visit: PKR ${booking.cost.visitFee} + Platform fee: PKR ${booking.cost.platformFee})\n` +
      `📞 **Contact:** ${p.phone}\n` +
      `🎫 **Booking ID:** \`${booking.bookingId}\`\n\n` +
      `I'll notify you when ${p.name} is on their way. 🚗`;
  } else if (state.discovery && state.discovery.candidates && state.discovery.candidates.length === 0) {
    reply = `😔 I couldn't find any **${intent.service || 'service provider'}** in **${intent.location || 'your area'}** right now.\n\n` +
      `You can try:\n• A different service type\n• A broader location (e.g., "Islamabad")\n• Check back later`;
  } else {
    reply = `⚠️ I understood your request but something went wrong during processing. Please try again.`;
  }

  return {
    sessionId,
    userInput,
    reply,
    intent,
    booking,
    rankedProviders: state.ranking?.ranked || [],
    trace,
    totalMs,
  };
}

module.exports = { orchestrate };
