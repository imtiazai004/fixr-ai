/**
 * KhidmatAI — Frontend App Logic
 * Google Antigravity Hackathon — Challenge 2
 */

'use strict';

// ─── STATE ────────────────────────────────────────────────────
const state = {
  activeTab:       'chat',
  bookings:        [],
  currentBooking:  null,
  currentRating:   0,
  map:             null,
  markers:         [],
  providerMarker:  null,
  trackingInterval: null,
  lastTrace:       [],
  recognition:     null,
  isListening:     false,
  allProviders:    [],
};

// ─── DOM REFS ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── INIT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(hideSplash, 2200);
  initNavigation();
  initChat();
  initVoice();
  initRatingModal();
  loadMapProviders();
  renderWelcomeMessage();
});

function hideSplash() {
  const splash = $('splash-screen');
  const app    = $('app');
  splash.style.opacity = '0';
  setTimeout(() => { splash.style.display = 'none'; app.classList.remove('hidden'); }, 500);
}

// ─── NAVIGATION ──────────────────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));

  if (tabId === 'map' && state.map) {
    setTimeout(() => state.map.invalidateSize(), 100);
  }
}

// ─── WELCOME MESSAGE ──────────────────────────────────────────
function renderWelcomeMessage() {
  const examples = [
    '"Mujhe G-13 mein AC technician chahiye"',
    '"Urgent plumber needed in Islamabad"',
    '"Electrician ki zaroorat hai, G-13/2"',
    '"Need a carpenter tomorrow morning"',
  ];
  const html = `
    <div class="msg ai">
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble">
        <strong>Assalam-o-Alaikum!</strong> I'm KhidmatAI, your AI service orchestrator.<br><br>
        I can find and book verified local providers for you — instantly.<br><br>
        <strong>Try saying:</strong><br>
        ${examples.map(e => `• <em>${e}</em>`).join('<br>')}
        <br><br>
        🎙️ <strong>Tip:</strong> Hit the mic button to use voice!
      </div>
    </div>`;
  $('chat-messages').insertAdjacentHTML('beforeend', html);
}

// ─── CHAT ─────────────────────────────────────────────────────
function initChat() {
  $('send-btn').addEventListener('click', sendMessage);
  $('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('chat-input').addEventListener('input', autoResize);
}

function autoResize() {
  const ta = $('chat-input');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
}

async function sendMessage() {
  const input = $('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  appendMsg('user', text);
  const typingId = showTyping();

  try {
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    removeTyping(typingId);
    handleResponse(data);
  } catch (err) {
    removeTyping(typingId);
    appendMsg('ai', '⚠️ Connection error. Make sure the server is running.');
  }
}

function handleResponse(data) {
  // Format reply markdown-style
  const formatted = data.reply
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(124,58,237,0.2);padding:2px 6px;border-radius:4px;font-size:12px">$1</code>')
    .replace(/\n/g, '<br>');

  appendMsg('ai', formatted, true);

  // Show ranked providers
  if (data.rankedProviders && data.rankedProviders.length > 0) {
    renderProviderCards(data.rankedProviders.slice(0, 3));
  }

  // Show booking card
  if (data.booking) {
    renderBookingCard(data.booking);
    addToBookingsList(data.booking);
    state.currentBooking = data.booking;
    startTrackingSimulation(data.booking);
  }

  // Update trace panel
  if (data.trace) {
    state.lastTrace = data.trace;
    renderTrace(data.trace);
    animatePipeline(data.trace);
  }

  scrollChat();
  speakResponse(data.booking
    ? `Booking confirmed! ${data.booking.provider.name} will arrive in ${data.booking.etaMinutes} minutes.`
    : 'I could not find a matching provider. Please try a different request.'
  );
}

function appendMsg(role, html, isHtml = false) {
  const avatar = role === 'user' ? '👤' : '🤖';
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${isHtml ? html : escapeHtml(html)}</div>`;
  $('chat-messages').appendChild(el);
  scrollChat();
}

function showTyping() {
  const id = 'typing-' + Date.now();
  const el = document.createElement('div');
  el.className = 'msg ai'; el.id = id;
  el.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
      </div>
    </div>`;
  $('chat-messages').appendChild(el);
  scrollChat();
  return id;
}

function removeTyping(id) { const el = $(id); if (el) el.remove(); }

function scrollChat() {
  const c = $('chat-messages');
  c.scrollTop = c.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── PROVIDER CARDS ────────────────────────────────────────────
function renderProviderCards(providers) {
  const container = document.createElement('div');
  container.className = 'provider-cards';
  container.innerHTML = providers.map((p, i) => `
    <div class="provider-card">
      <img class="provider-card-img" src="${p.image}" alt="${p.name}" onerror="this.src='https://via.placeholder.com/60x60/1e3a5f/ffffff?text=P'">
      <div class="provider-card-info">
        <div class="provider-card-name">${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 '}${p.name}</div>
        <div class="provider-card-row">
          <span class="provider-card-rating">⭐ ${p.rating} (${p.reviews || 0})</span>
          <span class="provider-card-dist">📍 ${p.distance}km</span>
          ${p.badge ? `<span class="provider-card-badge">${p.badge}</span>` : ''}
        </div>
        <div class="provider-card-score">Score: ${p.score ? p.score.total : 'N/A'}/10 • ${p.availability}</div>
      </div>
    </div>`).join('');
  $('chat-messages').appendChild(container);
}

// ─── BOOKING CARD ──────────────────────────────────────────────
function renderBookingCard(booking) {
  const p = booking.provider;
  const html = `
    <div class="booking-card">
      <img class="booking-card-img" src="${p.image}" alt="${p.name}" onerror="this.src='https://via.placeholder.com/400x140/1e3a5f/ffffff?text=Provider'">
      <div class="booking-card-body">
        <div class="booking-card-header">
          <div class="booking-provider-name">${p.name}</div>
          <span class="booking-status-chip">✅ Confirmed</span>
        </div>
        <div class="booking-id-chip">${booking.bookingId}</div>
        <div class="booking-meta">
          <div class="meta-item"><span class="meta-label">ETA</span><span class="meta-value">~${booking.etaMinutes} min</span></div>
          <div class="meta-item"><span class="meta-label">Cost</span><span class="meta-value">PKR ${booking.cost.total}</span></div>
          <div class="meta-item"><span class="meta-label">Phone</span><span class="meta-value">${p.phone}</span></div>
          <div class="meta-item"><span class="meta-label">Scheduled</span><span class="meta-value">${booking.scheduledFor}</span></div>
        </div>
        <div class="timeline">
          ${booking.timeline.map((s, i) => `
            <div class="tl-step ${i < 3 ? 'done' : ''}">
              <div class="tl-icon">${s.icon}</div>
              <div class="tl-label">${s.status}</div>
            </div>
            ${i < booking.timeline.length - 1 ? `<div class="tl-line ${i < 2 ? 'done' : ''}" id="tl-line-${i}"></div>` : ''}
          `).join('')}
        </div>
      </div>
    </div>`;
  $('booking-card-container').innerHTML = html;
  $('booking-card-container').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── BOOKINGS LIST ─────────────────────────────────────────────
function addToBookingsList(booking) {
  state.bookings.push(booking);
  const count = state.bookings.length;

  $('booking-badge-count').textContent = count;
  $('nav-bookings-badge').textContent  = count;
  $('nav-bookings-badge').classList.remove('hidden');

  const list = $('bookings-list');
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const card = document.createElement('div');
  card.className = 'booking-list-card';
  card.innerHTML = `
    <div class="booking-list-icon">🔧</div>
    <div class="booking-list-info">
      <div class="booking-list-title">${booking.service} — ${booking.provider.name}</div>
      <div class="booking-list-sub">📍 ${booking.location} • ⭐ ${booking.provider.rating}</div>
      <div class="booking-list-id">${booking.bookingId} • PKR ${booking.cost.total}</div>
    </div>
    <div class="booking-list-status">CONFIRMED</div>`;
  list.prepend(card);
}

// ─── TRACKING SIMULATION ──────────────────────────────────────
function startTrackingSimulation(booking) {
  switchTab('map');

  const bar      = $('tracking-bar');
  const label    = $('tracking-label');
  const etaEl    = $('tracking-eta');
  const progEl   = $('tracking-progress');
  const distEl   = $('tracking-distance');

  bar.classList.remove('hidden');
  label.textContent = `🚗 ${booking.provider.name} En Route`;

  let elapsed  = 0;
  const total  = booking.etaMinutes;        // in seconds (simulated)
  let distance = booking.provider.distance;

  if (state.trackingInterval) clearInterval(state.trackingInterval);

  // Place moving marker on map
  const startLat = booking.provider.lat + 0.01;
  const startLng = booking.provider.lng - 0.01;
  const endLat   = 33.6935;  // user home
  const endLng   = 72.9710;

  if (state.map) {
    if (state.providerMarker) state.map.removeLayer(state.providerMarker);
    const icon = L.divIcon({ html: '🚗', className: '', iconSize: [28, 28] });
    state.providerMarker = L.marker([startLat, startLng], { icon }).addTo(state.map);
    state.map.setView([startLat, startLng], 15);
  }

  state.trackingInterval = setInterval(() => {
    elapsed += 1;
    const pct = Math.min((elapsed / total) * 100, 100);
    progEl.style.width = pct + '%';
    distance = Math.max(booking.provider.distance - (pct / 100) * booking.provider.distance, 0);
    distEl.textContent = `📍 Distance: ${distance.toFixed(1)} km remaining`;
    etaEl.textContent  = `ETA: ~${Math.max(total - elapsed, 0)} min`;

    // Move marker
    if (state.map && state.providerMarker) {
      const ratio = pct / 100;
      state.providerMarker.setLatLng([
        startLat + (endLat - startLat) * ratio,
        startLng + (endLng - startLng) * ratio,
      ]);
    }

    if (pct >= 100) {
      clearInterval(state.trackingInterval);
      label.textContent = '📍 Provider Has Arrived!';
      etaEl.textContent  = 'Here now';
      distEl.textContent = '0.0 km — Arrived';
      appendMsg('ai', `📍 <strong>${booking.provider.name}</strong> has arrived at your location! Please let them in.`, true);
      switchTab('chat');
      setTimeout(() => showRatingModal(booking), 30000);
    }
  }, 1000);
}

// ─── MAP ──────────────────────────────────────────────────────
async function loadMapProviders() {
  try {
    const res  = await fetch('/api/providers');
    const data = await res.json();
    state.allProviders = data;
    initMap(data);
  } catch (e) {
    console.warn('[Map] Could not load providers:', e.message);
  }
}

function initMap(providers) {
  state.map = L.map('leaflet-map', { zoomControl: true, scrollWheelZoom: false }).setView([33.694, 72.972], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 18,
  }).addTo(state.map);

  providers.forEach(p => {
    if (!p.lat || !p.lng) return;
    const icon = L.divIcon({ html: `<div style="font-size:20px;filter:drop-shadow(0 2px 4px #000)">📍</div>`, className: '', iconSize: [24,24] });
    const marker = L.marker([p.lat, p.lng], { icon }).addTo(state.map);
    marker.bindPopup(`
      <strong>${p.name}</strong><br>
      ${p.category} • ⭐ ${p.rating}<br>
      📞 ${p.phone}<br>
      💰 PKR ${p.price || 'Free'}
    `);
    state.markers.push(marker);
  });

  $('provider-count').textContent = providers.length;
}

// ─── TRACE PANEL ─────────────────────────────────────────────
function renderTrace(trace) {
  const log  = $('trace-log');
  log.innerHTML = '';

  const agentColors = {
    'Intent Agent':   '#7C3AED',
    'Discovery Agent':'#3B82F6',
    'Ranking Agent':  '#F59E0B',
    'Booking Agent':  '#10B981',
    'Follow-up Agent':'#EC4899',
    'Orchestrator':   '#94A3B8',
  };

  trace.forEach((entry, idx) => {
    const color = agentColors[entry.agent] || '#94A3B8';
    const el    = document.createElement('div');
    el.className = 'trace-entry';
    el.innerHTML = `
      <div class="trace-entry-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? '' : 'none'">
        <span class="trace-agent-name" style="color:${color}">${entry.agent || 'Agent ' + (idx+1)}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="trace-agent-status ${entry.status}">${entry.status || 'DONE'}</span>
          ${entry.processingMs !== undefined ? `<span class="trace-ms">${entry.processingMs}ms</span>` : ''}
        </div>
      </div>
      <div class="trace-entry-body">
${(entry.reasoning || []).join('\n')}
      </div>`;
    log.appendChild(el);
  });

  $('export-trace-btn').onclick = exportTrace;
}

function animatePipeline(trace) {
  const agentDots = {
    'Intent Agent':    'dot-intent',
    'Discovery Agent': 'dot-discovery',
    'Ranking Agent':   'dot-ranking',
    'Booking Agent':   'dot-booking',
    'Follow-up Agent': 'dot-followup',
  };
  const lines = ['line-1','line-2','line-3','line-4'];

  // Reset all
  Object.values(agentDots).forEach(id => { const d = $(id); if(d){ d.className = 'pipeline-dot pending'; } });
  lines.forEach(id => { const l = $(id); if(l){ l.classList.remove('done'); } });

  trace.forEach((entry, i) => {
    const dotId = agentDots[entry.agent];
    if (!dotId) return;
    setTimeout(() => {
      const dot = $(dotId);
      if (!dot) return;
      dot.className = 'pipeline-dot ' + (entry.status === 'SUCCESS' ? 'done' : entry.status === 'FAILED' ? 'error' : 'done');
      if (i > 0 && lines[i-1]) { const line = $(lines[i-1]); if(line) line.classList.add('done'); }
    }, i * 400);
  });
}

function exportTrace() {
  const blob = new Blob([JSON.stringify(state.lastTrace, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url;
  a.download = `khidmatai-trace-${Date.now()}.json`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── VOICE ───────────────────────────────────────────────────
function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $('mic-btn').title = 'Voice not supported in this browser';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous    = false;
  recognition.interimResults = false;
  recognition.lang          = 'ur-PK';   // Urdu preferred; fallback to English

  recognition.onresult = e => {
    const text = e.results[0][0].transcript;
    $('chat-input').value = text;
    stopListening(recognition);
    setTimeout(sendMessage, 300);
  };

  recognition.onerror = () => stopListening(recognition);
  recognition.onend   = () => stopListening(recognition);
  state.recognition = recognition;

  $('mic-btn').addEventListener('click', () => {
    if (state.isListening) { stopListening(recognition); }
    else { startListening(recognition); }
  });
}

function startListening(rec) {
  state.isListening = true;
  $('mic-btn').classList.add('listening');
  $('mic-btn').innerHTML = '<i class="fa-solid fa-stop"></i>';
  try { rec.start(); } catch(e){}
}

function stopListening(rec) {
  state.isListening = false;
  $('mic-btn').classList.remove('listening');
  $('mic-btn').innerHTML = '<i class="fa-solid fa-microphone"></i>';
  try { rec.stop(); } catch(e){}
}

function speakResponse(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang  = 'en-US'; utt.rate = 1.0; utt.pitch = 1.0;
  window.speechSynthesis.speak(utt);
}

// ─── RATING MODAL ─────────────────────────────────────────────
function initRatingModal() {
  document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      state.currentRating = parseInt(star.dataset.value);
      document.querySelectorAll('.star').forEach((s, i) =>
        s.classList.toggle('active', i < state.currentRating)
      );
    });
  });
  $('submit-rating-btn').addEventListener('click', submitRating);
  $('skip-rating-btn').addEventListener('click', () => $('rating-modal').classList.add('hidden'));
}

function showRatingModal(booking) {
  $('rating-modal-provider').textContent = `How was ${booking.provider.name}?`;
  $('rating-modal').classList.remove('hidden');
}

async function submitRating() {
  if (!state.currentRating) { alert('Please select a rating.'); return; }
  const booking = state.currentBooking;
  if (!booking) return;

  try {
    const res  = await fetch('/api/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId: booking.bookingId,
        rating:    state.currentRating,
        comment:   $('rating-comment').value,
      }),
    });
    const data = await res.json();
    $('rating-modal').classList.add('hidden');
    appendMsg('ai', data.message, false);
    scrollChat();
  } catch (e) {
    $('rating-modal').classList.add('hidden');
    appendMsg('ai', '⚠️ Could not submit rating. Try again.');
  }
}
