/**
 * KhidmatAI — Express Server
 * Google Antigravity Hackathon — Challenge 2
 */

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { orchestrate } = require('./orchestrator');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: Main orchestration endpoint ─────────────────────────
app.post('/api/chat', async (req, res) => {
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
  console.log(`║   KhidmatAI — Antigravity Hackathon    ║`);
  console.log(`║   Running at: http://localhost:${PORT}     ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});
