/* ═══════════════════════════════════════════════════════════
   Fixr — Voice Agent  (v5)
   True conversational AI with:
     • Session-based memory (multi-turn context)
     • Real barge-in: user can interrupt Fixr mid-sentence
     • Continuous always-ready listening after each turn
     • Gemini deep reasoning via function calling
     • ElevenLabs TTS + browser Speech fallback
     • Multilingual: EN / Roman Urdu / Urdu script
═══════════════════════════════════════════════════════════ */

// ── DOM References ──────────────────────────────────────────
const userInput        = document.getElementById('user-input');
const sendBtn          = document.getElementById('send-btn');
const micBtn           = document.getElementById('mic-btn');
const imgBtn           = document.getElementById('img-btn');
const chatContainer    = document.getElementById('chat-container');
const traceContent     = document.getElementById('trace-content');
const activeBookingCard = document.getElementById('active-booking-card');
const statBookings     = document.getElementById('stat-bookings');
const chatInputArea    = document.getElementById('chat-input-area');
const appStatus        = document.getElementById('app-status');
const stopBtn          = document.getElementById('stop-btn');
const diyModal         = document.getElementById('diy-modal');
const closeModal       = document.getElementById('close-modal');
const diyStepText      = document.getElementById('diy-step-text');
const videoInstruction = document.getElementById('video-instruction');
const prevStepBtn      = document.getElementById('prev-step');
const nextStepBtn      = document.getElementById('next-step');

// ── Voice Agent State ───────────────────────────────────────
let sessionId          = null;   // Server-side conversation session
let bookingCount       = 0;
let map;
let isStopped          = false;
let isAgentSpeaking    = false;  // True while TTS is playing
let isProcessing       = false;  // True while waiting for API response
let bargeinActive      = false;  // Barge-in just fired
let currentAudioPlay   = null;
let activeSpeechLang   = 'en-US';
let lastDetectedLang   = 'ENGLISH';
let autoListenTimer    = null;   // Timeout for auto-listen after agent speaks
// ── KEY: Expose speak()'s resolve so stopCurrentSpeech() can unblock it ─────
let speakDoneCallback  = null;   // Called by stopCurrentSpeech() to unblock await speak()
let pendingBargeInText = null;   // Barge-in text queued while isProcessing was true
let wakeWordRestartTimer = null; // Timer to restart recognition for wake word loop
let inputMode          = 'text'; // 'voice' | 'text'
let micPermissionDenied = false; // Set true on 'not-allowed' — stops infinite restart loop
let voiceCardResetTimer = null;  // Timer ref for voice card idle reset (so we can cancel it)

// ══════════════════════════════════════════════════════════════
// PWA — Service Worker + Install Prompt
// ══════════════════════════════════════════════════════════════

// ── 1. Register Service Worker ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => {
                console.log('[SW] Registered, scope:', reg.scope);
                // If a new SW is waiting (updated app), notify when user is idle
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker?.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('[SW] Update available — reload to apply');
                            // Optionally show "App updated — tap to refresh" banner
                        }
                    });
                });
            })
            .catch(err => console.warn('[SW] Registration failed:', err));
    });
}

// ── 2. Capture Android "Add to Home Screen" prompt ──────────────────────────
// Chrome fires this event when the app meets PWA install criteria.
// We preventDefault() to stop the mini-infobar and show our own banner.
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    // Show install banner after 5 seconds (give user time to explore first)
    setTimeout(showInstallBanner, 5000);
});

// Once installed, clean up
window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) { banner.classList.remove('show'); setTimeout(() => banner.remove(), 400); }
    setStatus('📲 App installed!', '#10b981');
    setTimeout(() => setStatus('AI Ready', '#10b981'), 3000);
    console.log('[PWA] App installed successfully!');
});

function showInstallBanner() {
    // Don't show if: already installed, already showing, or prompt expired
    if (!deferredInstallPrompt || document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
        <div class="install-banner-left">
            <span class="install-icon">⚡</span>
            <div>
                <div class="install-title">Install Fixr App</div>
                <div class="install-sub">Works offline · Loads instantly · Like a native app</div>
            </div>
        </div>
        <button id="pwa-install-btn" class="install-btn">Install</button>
        <button id="pwa-dismiss-btn" class="install-dismiss" title="Not now">✕</button>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));

    document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        banner.classList.remove('show');
        setTimeout(() => banner.remove(), 400);
        console.log('[PWA] Install outcome:', outcome);
    });

    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
        banner.classList.remove('show');
        setTimeout(() => banner.remove(), 400);
        deferredInstallPrompt = null; // Don't show again this session
    });
}

// ── 3. iOS install hint ─────────────────────────────────────────────────────
// iOS Safari has NO native install prompt — users must use Share → Add to Home Screen.
// Show a gentle hint banner for iOS users who haven't installed yet.
const isIOS     = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isInApp   = window.navigator.standalone === true; // Already installed as PWA
const isSafari  = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

if (isIOS && !isInApp && isSafari) {
    setTimeout(() => {
        const hint = document.createElement('div');
        hint.id = 'ios-install-hint';
        hint.innerHTML = `
            <div class="ios-hint-inner">
                <span style="font-size:1.4rem;">📲</span>
                <div style="flex:1;">
                    <div style="font-weight:700;font-size:0.82rem;">Add Fixr to Home Screen</div>
                    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">
                        Tap <b>Share</b> <span style="font-size:1rem;">⬆️</span> then <b>"Add to Home Screen"</b>
                    </div>
                </div>
                <button id="ios-hint-close" style="background:none;border:none;color:var(--text-muted);font-size:1rem;cursor:pointer;padding:4px 6px;border-radius:8px;">✕</button>
            </div>
        `;
        document.body.appendChild(hint);
        requestAnimationFrame(() => hint.classList.add('show'));

        document.getElementById('ios-hint-close')?.addEventListener('click', () => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 400);
        });
        // Auto-dismiss after 8 seconds
        setTimeout(() => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 400);
        }, 8000);
    }, 6000);
}

// ── 4. Online / Offline indicator ───────────────────────────────────────────
window.addEventListener('online',  () => {
    setStatus('🌐 Back online', '#10b981');
    setTimeout(() => setStatus('AI Ready', '#10b981'), 2500);
});
window.addEventListener('offline', () => {
    setStatus('📴 Offline — voice & search paused', '#f59e0b');
});

// ── Screen Wake Lock — keeps phone screen on while app is open ──────────────
// This allows wake word detection even when user isn't actively touching the screen
let wakeLock = null;
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[WakeLock] Screen kept awake for wake word listening');
        } catch (e) { /* Device may not support it */ }
    }
}
requestWakeLock();
// Re-acquire wake lock when tab becomes visible again (e.g. user switches back)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});

// ── Mobile Audio Unlock ─────────────────────────────────────────────────────
// iOS and Android block Audio.play() when NOT triggered by a direct user gesture.
// The API response arrives asynchronously — too late for the activation window.
// Fix: play a silent audio clip on the FIRST tap/click anywhere on the page.
// After that, the page has "sticky activation" and all subsequent plays work.
let audioUnlocked = false;
// Minimal silent WAV (44 bytes): 1 sample, 22050 Hz, 16-bit mono — inaudible
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAIBWAAACABAAZGF0YQAAAAA=';

function attemptUnlockAudio() {
    if (audioUnlocked) return;
    try {
        const snd = new Audio(SILENT_WAV);
        snd.volume = 0.001;
        snd.play().then(() => {
            audioUnlocked = true;
            console.log('[Audio] Autoplay unlocked — ElevenLabs TTS will work');
            showAudioToast();
        }).catch(() => { /* Will retry on next gesture */ });
    } catch(e) { /* Older browsers */ }
}

function showAudioToast() {
    const toast = document.createElement('div');
    toast.className = 'audio-toast';
    toast.textContent = '🔊 Voice enabled!';
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 1800);
}

// Unlock on FIRST touch or click anywhere — passive:true required by iOS for touchstart
// ALSO: try to start wake word recognition on first touch.
// iOS Safari blocks SpeechRecognition.start() without a user gesture.
// The setTimeout(1500ms) on page load often fires before any gesture on iOS.
// By also trying here (on first actual touch), iOS wake-word detection starts correctly.
document.addEventListener('touchstart', () => {
    attemptUnlockAudio();
    // Start wake word recognition on first user touch if it hasn't started yet
    if (SpeechRecognition && !isRecognitionRunning && !isStopped && !voiceEverStarted) {
        setTimeout(() => {
            if (!isRecognitionRunning && !isStopped) {
                console.log('[WakeWord] Starting after first touch gesture');
                startWakeWordListening();
            }
        }, 400); // Short delay so the gesture is fully registered
    }
}, { passive: true });
document.addEventListener('click', () => {
    attemptUnlockAudio();
    // Also retry wake word recognition on any click if it failed to auto-start
    if (SpeechRecognition && !isRecognitionRunning && !isStopped && !micPermissionDenied && !isAgentSpeaking) {
        setTimeout(() => {
            if (!isRecognitionRunning && !isStopped && !micPermissionDenied) startWakeWordListening();
        }, 400);
    }
});

// ── GPS ─────────────────────────────────────────────────────
let userLocation = { lat: 33.6938, lng: 72.9717 }; // G-13 default
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        pos => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setStatus('📍 GPS Ready', '#10b981');
            setTimeout(() => setStatus('AI Ready', '#10b981'), 2000);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

// ── Show welcome immediately — no blank chat while server loads ─────────────
// Called synchronously before initSession fetch so user sees chat right away.
showChatWelcome();

// ── Initialize session with server ─────────────────────────
async function initSession() {
    try {
        const r = await fetch('/api/session', { method: 'POST' });
        const d = await r.json();
        sessionId = d.sessionId;
        console.log('[Session] Created:', sessionId);
    } catch (e) {
        console.warn('[Session] Could not init:', e.message);
        sessionId = 'local-' + Date.now(); // fallback
    }
    // Session ready — no need to re-render welcome (already shown above)
}
initSession();

// ── Fresh chat welcome — called on every page load ──────────────────────────
// By generating this in JS (not hard-coded HTML), the chat is guaranteed to
// start clean each time the user opens the app or refreshes the page.
function showChatWelcome() {
    if (!chatContainer) return;
    chatContainer.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'chat-welcome';
    wrap.innerHTML = `
        <div class="chat-avatar-ring">🤖</div>
        <div class="message bot-message">
            Assalamu Alaikum! 👋 Main <b>Fixr AI</b> hoon — aapka smart local services assistant.<br><br>
            🏠 <b>Home tab</b> par service request karein, ya neeche type karein.<br>
            🎤 <b>Mic button</b> tap kar ke baat karein, ya <b>"Hey Fixr"</b> bol ke wake karein.<br>
            🧠 <b>Pipeline tab</b> mein AI agents live kaam karte dikhayi dete hain.<br><br>
            📍 Coverage: Islamabad, Rawalpindi &amp; surrounding areas.
        </div>`;
    chatContainer.appendChild(wrap);
}

// ── Wake Word Background Listener ──────────────────────────────────────────
// Silently starts recognition to listen for wake words:
//   "Fixr", "Fixer", "Hey Fixr", "Hey Fixer", "Hello Fixr", "Hello Fixer"
// The mic is NOT visually active in this state — no pulsing orb, no status change.
// Voice is ONLY activated when:
//   a) User says one of the wake words above, OR
//   b) User taps the mic button (🎤) directly.
//
// IMPORTANT: On iOS Safari, SpeechRecognition requires a prior user gesture.
// The first tap anywhere on the page (touchstart) will silently unlock it.
// If it can't auto-start (first load before any tap), it will start after first touch.

let voiceEverStarted = false; // Becomes true once recognition has ever started
let wakeWordModeActive = false; // True when listening silently for wake word

function startWakeWordListening() {
    // Don't start if: permission denied, already running, stopped, processing, or speaking
    if (micPermissionDenied || !SpeechRecognition || isRecognitionRunning || isStopped || isProcessing || isAgentSpeaking) return;
    wakeWordModeActive = true;
    recognition.lang = activeSpeechLang;
    try {
        recognition.start();
        // Show a subtle mic indicator so user knows background listening is active
        setStatus('🎙 AI Ready', '#10b981');
    } catch(e) { /* InvalidStateError = already started, ignore */ }
}

// Delay auto-start slightly to let the page fully render and scripts settle
setTimeout(() => {
    if (!SpeechRecognition) {
        setStatus('Type your request 📝', '#94a3b8');
        return;
    }
    startWakeWordListening();
    // After first load, quietly indicate AI is ready
    setStatus('AI Ready', '#10b981');
}, 1500);

// ── Status Helper ───────────────────────────────────────────
function setStatus(text, color = '#10b981') {
    if (!appStatus) return;
    appStatus.textContent = text;
    appStatus.style.color        = color;
    appStatus.style.background   = `${color}18`;
    appStatus.style.borderColor  = `${color}33`;
}

// ── Pipeline Helpers ────────────────────────────────────────
const AGENT_NODE_MAP = {
    'Intent Agent':    'intent',
    'Discovery Agent': 'discovery',
    'Ranking Agent':   'ranking',
    'Booking Agent':   'booking',
    'Follow-up Agent': 'followup',
};

function setPipelineNode(nodeKey, state) {
    const node = document.getElementById('node-' + nodeKey);
    if (!node) return;
    node.className = 'pipeline-node ' + state;
    // When an agent starts working, show it prominently in the subtitle
    if (state === 'running') {
        const labels = {
            intent:    '🔍 Intent Agent',
            discovery: '🌐 Discovery Agent',
            ranking:   '📊 Ranking Agent',
            booking:   '📅 Booking Agent',
            followup:  '🔔 Follow-up Agent',
        };
        const pipelineText = document.getElementById('pipeline-status-text');
        if (pipelineText) pipelineText.textContent = `⚡ ${labels[nodeKey] || nodeKey} is working...`;
    }
}
function setPipelineArrow(idx, active) {
    const arrow = document.getElementById('conn-' + idx);
    if (arrow) arrow.classList.toggle('active', active);
}
function resetPipeline() {
    ['intent','discovery','ranking','booking','followup'].forEach(k => setPipelineNode(k, 'idle'));
    [1,2,3,4].forEach(i => setPipelineArrow(i, false));
    const pipelineText = document.getElementById('pipeline-status-text');
    if (pipelineText) pipelineText.innerHTML =
        '<span style="color:#ef4444;font-weight:800;animation:livePulse 1s ease-in-out infinite;display:inline-block;">● LIVE</span> &nbsp;— Agents activating...';
}
function completePipeline(message = 'Pipeline complete') {
    const pipelineText = document.getElementById('pipeline-status-text');
    if (pipelineText) pipelineText.textContent = '✅ ' + message;
}

// ── Map Init ────────────────────────────────────────────────
function initMap() {
    if (map) return;
    map = L.map('map').setView([33.6938, 72.9717], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    L.marker([33.6938, 72.9717]).addTo(map).bindPopup('<b>You</b>').openPopup();
}

// ── Tab Switching ───────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => {
            c.classList.remove('active');
            if (c.id === target) c.classList.add('active');
        });
        chatInputArea.style.display = target === 'dashboard-container' ? 'none' : 'flex';
        if (target === 'dashboard-container' && !map) setTimeout(initMap, 120);
    });
});
chatInputArea.style.display = 'flex';

// ══════════════════════════════════════════════════════════════
// STOP — halts everything
// ══════════════════════════════════════════════════════════════
function stopAllFixr() {
    isStopped = true;
    isProcessing = false;      // Unblock any stuck processing gate
    pendingBargeInText = null; // Discard any queued barge-in text
    stopCurrentSpeech();       // Also calls speakDoneCallback → resolves speak()
    clearTimeout(autoListenTimer);
    clearTimeout(wakeWordRestartTimer);

    if (recognition) { try { recognition.abort(); } catch(e) {} }

    micBtn.classList.remove('listening');
    const voiceOrb = document.getElementById('voice-orb');
    if (voiceOrb) voiceOrb.classList.remove('listening');
    stopBtn.classList.remove('active');
    setStatus('⏹ Stopped', '#94a3b8');

    const searchingState = document.getElementById('searching-state');
    if (searchingState) searchingState.style.display = 'none';
    showBargeInBanner(false);
}
stopBtn.addEventListener('click', stopAllFixr);

// ══════════════════════════════════════════════════════════════
// SPEECH SYNTHESIS + BARGE-IN SUPPORT
// ══════════════════════════════════════════════════════════════
function stopCurrentSpeech() {
    isAgentSpeaking = false;
    // Stop ElevenLabs audio
    if (currentAudioPlay) {
        try { currentAudioPlay.pause(); } catch(e) {}
        currentAudioPlay = null;
    }
    // Stop browser TTS (cancel fires onerror='interrupted' which calls onDone via utt.onerror)
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch(e) {} }
    // ── CRITICAL FIX: Unblock any pending await speak() ──────────────────────
    // currentAudioPlay.pause() does NOT fire onended, so the speak() Promise
    // would hang forever. We resolve it here via the exposed callback.
    if (speakDoneCallback) {
        const cb = speakDoneCallback;
        speakDoneCallback = null;
        cb(); // Resolves the speak() Promise → unblocks processUserInput
    }
}

function showBargeInBanner(show) {
    let banner = document.getElementById('bargein-banner');
    if (show) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'bargein-banner';
            banner.style.cssText = `
                position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) scale(0.8);
                background:rgba(99,102,241,0.92); color:white; padding:10px 22px;
                border-radius:30px; font-size:0.82rem; font-weight:700;
                z-index:9999; pointer-events:none;
                transition:all 0.2s ease; opacity:0; letter-spacing:0.3px;
                box-shadow: 0 8px 30px rgba(99,102,241,0.4);
            `;
            banner.textContent = '🎙️ Interrupted — listening...';
            document.body.appendChild(banner);
        }
        requestAnimationFrame(() => {
            banner.style.opacity = '1';
            banner.style.transform = 'translate(-50%,-50%) scale(1)';
        });
    } else if (banner) {
        banner.style.opacity = '0';
        banner.style.transform = 'translate(-50%,-50%) scale(0.8)';
        setTimeout(() => banner.remove(), 250);
    }
}

// Flash the voice orb + status to show wake word activated
function showWakeEffect() {
    const orb = document.getElementById('voice-orb');
    if (orb) {
        orb.style.boxShadow = '0 0 0 12px rgba(99,102,241,0.3)';
        orb.style.background = 'var(--primary)';
        setTimeout(() => { orb.style.boxShadow = ''; orb.style.background = ''; }, 800);
    }
    setStatus('👂 Fixr sunta hai!', '#6366f1');
}

// Called when ALL TTS has finished — restarts listening in wake-word mode
// (or command mode if a voice conversation is ongoing)
function restartListeningAfterSpeech(isUrdu = false) {
    if (isStopped || isProcessing) return;
    clearTimeout(autoListenTimer);
    autoListenTimer = setTimeout(() => {
        if (!isStopped && !isProcessing && !isAgentSpeaking) {
            // Stay in command mode (for follow-up) if user was in voice mode
            if (inputMode === 'voice') {
                wakeWordModeActive = false;
                setStatus('Awaiting your reply... 🎙️', '#a855f7');
            } else {
                wakeWordModeActive = true;
                setStatus('🎙 AI Ready', '#10b981');
            }
            if (!isRecognitionRunning) startRecognition(isUrdu ? 'ur-PK' : 'en-US');
        }
    }, 1200); // 1.2s buffer — lets speaker audio fully decay before mic re-opens
}

function speak(text, base64Audio = null, lang = 'en-US') {
    if (isStopped) return Promise.resolve();

    stopCurrentSpeech();

    // ── ABORT mic BEFORE playing audio ──────────────────────────────────────
    // This is the critical fix for the echo loop.
    // We abort recognition immediately so the mic is OFF while speakers are playing.
    // restartListeningAfterSpeech() will re-open the mic with a 1.2s delay after
    // audio ends — enough time for speaker sound to decay completely.
    if (recognition && isRecognitionRunning) {
        try { recognition.abort(); } catch(e) {}
        isRecognitionRunning = false;
    }

    isAgentSpeaking = true;
    stopBtn.classList.add('active');

    return new Promise((resolve) => {
        let resolved = false;

        function onDone() {
            if (resolved) return;  // Guard against double-resolve
            resolved = true;
            speakDoneCallback = null; // Clear the exposed callback
            isAgentSpeaking = false;
            stopBtn.classList.remove('active');
            resolve();
        }

        // Expose onDone so stopCurrentSpeech() can unblock us
        speakDoneCallback = onDone;

        if (base64Audio) {
            try {
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                if (currentAudioPlay) { currentAudioPlay.pause(); currentAudioPlay = null; }
                currentAudioPlay = new Audio(`data:audio/mp3;base64,${base64Audio}`);
                currentAudioPlay.onended = onDone;
                currentAudioPlay.onerror = onDone;
                currentAudioPlay.play().catch(err => {
                    // ── MOBILE AUTOPLAY BLOCKED ──────────────────────────────────────
                    // NotAllowedError: audio.play() was blocked because the user gesture
                    // activation window expired (API call took too long).
                    // Solution: fall back to browser speechSynthesis which works even
                    // without direct gesture activation on most mobile browsers.
                    console.warn('[Audio] Autoplay blocked (' + err.name + ') — falling back to browser TTS');
                    currentAudioPlay = null;
                    if (window.speechSynthesis && text && text.trim()) {
                        window.speechSynthesis.cancel();
                        const fallbackUtt = new SpeechSynthesisUtterance(text);
                        fallbackUtt.lang  = lang;
                        fallbackUtt.rate  = 1.05;
                        fallbackUtt.onend   = onDone;
                        fallbackUtt.onerror = onDone;
                        window.speechSynthesis.speak(fallbackUtt);
                    } else {
                        onDone(); // Nothing to speak — resolve immediately
                    }
                });
                return;
            } catch (e) {
                console.warn('[ElevenLabs] Exception, falling back to browser TTS:', e.message);
            }
        }

        if (window.speechSynthesis && text && text.trim()) {
            window.speechSynthesis.cancel();
            const utt = new SpeechSynthesisUtterance(text);
            utt.lang  = lang;
            utt.rate  = 1.05;
            utt.onend   = onDone;
            utt.onerror = onDone;
            window.speechSynthesis.speak(utt);
        } else {
            onDone();
        }
    });
}

// ══════════════════════════════════════════════════════════════
// SPEECH RECOGNITION — continuous with barge-in
// ══════════════════════════════════════════════════════════════
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let isRecognitionRunning = false;
let pendingBargeText     = '';

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    // continuous:true = ONE session runs forever → ZERO restart-beeps
    // The browser plays a beep only on start() and stop()/abort().
    // With continuous:true we start once and never stop during normal use.
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = activeSpeechLang;

    recognition.onstart = () => {
        isRecognitionRunning = true;
        voiceEverStarted = true;
        // Show active UI only when in command mode (not silent wake-word background)
        if (!wakeWordModeActive && !isAgentSpeaking) {
            micBtn.classList.add('listening');
            const voiceOrb = document.getElementById('voice-orb');
            if (voiceOrb) voiceOrb.classList.add('listening');
            setStatus('Listening... 🎙️', '#ef4444');
        }
    };

    recognition.onresult = (event) => {
        // ── ECHO GUARD ───────────────────────────────────────────────────────
        // When TTS is playing through speakers, the mic picks up the audio.
        // This creates an echo loop: Fixr speaks → mic hears itself → triggers again.
        // Fix: completely ignore ALL mic input while agent is speaking.
        if (isAgentSpeaking) return;

        let interimText = '';
        let finalText   = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal) {
                finalText = transcript;
            } else {
                interimText = transcript;
            }
        }

        // Show interim text in input box only in command mode
        if (interimText && !wakeWordModeActive) userInput.value = interimText;

        // ── WAKE WORD DETECTION ───────────────────────────────────────────────
        // Triggers on: "Fixr", "Fixer", "Hey Fixr", "Hey Fixer",
        //              "Hello Fixr", "Hello Fixer" (+ phonetic variants)
        const anyText = (finalText || interimText).toLowerCase().trim();

        // ── WAKE WORD DETECTION ──────────────────────────────────────────────────
        // Accepted triggers: "Fixr", "Fixer", "Fix", "Hey Fixr", "Hello Fixer",
        //   "Hi Fix", plus phonetic variants the browser might transcribe.
        // The regex uses word boundaries so "fix" in "prefix" does NOT trigger.
        // Keeping it broad because browsers often transcribe "Fixr" as just "fix".
        const hasWakeWord =
            // Core pattern: optional greeting + any spelling of Fixr/Fixer/Fix
            /\b(hey\s+|hello\s+|hi\s+|ok\s+)?fix[re]?r?\b/i.test(anyText) ||
            // Phonetic variants the browser might produce
            anyText.includes('fiksur')    ||
            anyText.includes('fiksir')    ||
            anyText.includes('fixar')     ||
            anyText.includes('phixer')    ||
            anyText.includes('phixr')     ||
            anyText.includes('phiksur')   ||
            anyText.includes('fixer')     ||
            // Explicit greeting combos (belt-and-suspenders over the regex)
            anyText.includes('hey fixr')   ||
            anyText.includes('hey fixer')  ||
            anyText.includes('hey fix')    ||
            anyText.includes('hello fixr') ||
            anyText.includes('hello fixer')||
            anyText.includes('hello fix')  ||
            anyText.includes('ok fixr')    ||
            anyText.includes('ok fixer');

        // Debug: briefly flash what the mic heard in the status bar.
        // This lets the user see EXACTLY what Chrome is transcribing when they say "Fixr".
        // If wake word never triggers, they can see what word Chrome is hearing instead.
        if (wakeWordModeActive && finalText && finalText.length > 0) {
            console.log('[WakeWord] heard:', JSON.stringify(anyText), '| match:', hasWakeWord);
            setStatus('👂 "' + finalText.slice(0, 18) + '"', '#94a3b8');
            // Reset back to mic-ready indicator after 2s
            setTimeout(() => {
                if (wakeWordModeActive && !isProcessing) setStatus('🎙 AI Ready', '#10b981');
            }, 2000);
        }

        if (hasWakeWord) {
            if (finalText) {
                // Strip wake word prefix to isolate the actual command
                // e.g. "Hey Fixr mujhe plumber chahiye" → "mujhe plumber chahiye"
                const afterWake = finalText
                    .replace(/\b(hey|hello|hi|ok)\s+/gi, '')
                    .replace(/\bfix[re]?r?[,!\s]*/gi, '')
                    .trim();
                showWakeEffect();
                userInput.value = '';
                wakeWordModeActive = false; // Exit silent wake-word mode

                if (afterWake.length > 2 && !isProcessing) {
                    // Full command came in the same utterance — process immediately
                    inputMode = 'voice';
                    attemptUnlockAudio();
                    stopCurrentSpeech();
                    bargeinActive = false;
                    pendingBargeInText = null;
                    processUserInput(afterWake);
                } else {
                    // Only the wake word was heard — no command yet.
                    // CRITICAL: Do NOT call stopRecognition() + startRecognition() here.
                    // That would end the continuous session and trigger a browser beep.
                    // Since continuous:true is already running, just flip the mode flag
                    // and update the UI — the same session keeps listening for the command.
                    inputMode = 'voice';
                    attemptUnlockAudio();
                    // wakeWordModeActive is already false (set above before this block)
                    micBtn.classList.add('listening');
                    const voiceOrb = document.getElementById('voice-orb');
                    if (voiceOrb) voiceOrb.classList.add('listening');
                    setStatus('👂 Listening for command...', '#6366f1');
                    // Zero beep — continuous session stays alive, same mic, same stream
                }
            } else {
                // Interim: show quick feedback that wake word was heard
                setStatus('👂 Fixr...', '#6366f1');
            }
            return; // Don't fall through to normal processing
        }

        // ── If we're in silent wake-word mode and user spoke something that's NOT
        //    a wake word — ignore it (don't process random background audio)
        if (wakeWordModeActive && finalText) {
            // Background noise / someone else talking — quietly restart wake word listener
            return;
        }

        if (!finalText) return;

        userInput.value = '';
        inputMode = 'voice'; // Any valid voice recognition result = voice mode

        // Stop commands — English + Roman Urdu + Urdu script
        // Use word-boundary check for short words to avoid false matches
        // ('bas' must not match 'basically', 'ruk' must not match 'rukus' etc.)
        const lower = finalText.toLowerCase();
        const lowerWords = lower.split(/\s+/);
        const STOP_EXACT  = ['stop','bas','ruk','chup','quiet'];  // exact word match only
        const STOP_PHRASE = [                                      // substring OK (multi-word)
            'bas karo','bas kar','roko','ruk ja','ruk jao',
            'khamosh','band karo','band kar','chup kar','chup raho',
            'shut up','shutup','silence',
            'رکو','بند کرو','خاموش','بس کرو','چپ','روکو',
        ];
        const isStopCmd = STOP_EXACT.some(w => lowerWords.includes(w))
                       || STOP_PHRASE.some(w => lower.includes(w) || finalText.includes(w));
        if (isStopCmd) {
            stopAllFixr();
            return;
        }

        showBargeInBanner(false);
        bargeinActive = false;

        // ── CRITICAL FIX: Queue barge-in text if currently processing ──────
        // isProcessing = true means we're inside an await speak() that just got
        // stopped. The processUserInput() call would be silently dropped. Instead,
        // queue the text so processUserInput picks it up after it finishes.
        if (isProcessing) {
            pendingBargeInText = finalText;
        } else {
            processUserInput(finalText);
        }
    };

    recognition.onerror = (e) => {
        isRecognitionRunning = false;
        micBtn.classList.remove('listening');
        const voiceOrb = document.getElementById('voice-orb');
        if (voiceOrb) voiceOrb.classList.remove('listening');

        if (e.error === 'aborted') {
            // Intentional abort — we triggered this ourselves, nothing to do
            return;
        }
        if (e.error === 'not-allowed') {
            // Mic permission denied — set permanent flag so onend doesn't restart
            micPermissionDenied = true;
            voiceEverStarted = false;
            setStatus('Mic blocked — allow mic in browser settings 🔒', '#ef4444');
            return; // Do NOT restart — user must grant permission manually
        }
        // 'no-speech': mic timed out silently — completely normal, just restart quietly
        // 'audio-capture': hardware issue — retry after delay
        // 'network': connection blip — retry after delay
        if (e.error !== 'no-speech') {
            console.warn('[Recognition] Error:', e.error, '— will retry wake-word listener');
        }

        // Return to silent wake-word mode after a short delay
        if (!isStopped && !isProcessing && !isAgentSpeaking) {
            clearTimeout(wakeWordRestartTimer);
            wakeWordRestartTimer = setTimeout(() => {
                if (!isRecognitionRunning && !isStopped && !isProcessing && !isAgentSpeaking) {
                    wakeWordModeActive = true;
                    setStatus('AI Ready', '#10b981');
                    startWakeWordListening();
                }
            }, e.error === 'no-speech' ? 300 : 1500);
        }
    };

    recognition.onend = () => {
        // With continuous:true, onend only fires when:
        //   a) recognition.abort() / recognition.stop() was called explicitly, OR
        //   b) iOS Safari hits its ~60-second session limit, OR
        //   c) A network/hardware error occurred (onerror fires first, then onend)
        // It does NOT fire after every utterance like with continuous:false.

        isRecognitionRunning = false;
        micBtn.classList.remove('listening');
        const voiceOrb = document.getElementById('voice-orb');
        if (voiceOrb) voiceOrb.classList.remove('listening');
        stopBtn.classList.remove('active');

        // Explicit stop — stay stopped, don't auto-restart
        if (isStopped) { setStatus('⏹ Stopped', '#94a3b8'); return; }

        // TTS is playing — recognition was aborted to prevent echo.
        // It will be restarted by restartListeningAfterSpeech() when TTS finishes.
        if (isAgentSpeaking) return;

        // API call in progress — restart once it finishes (handled in processUserInput)
        if (isProcessing) return;

        // iOS timeout or unexpected end — restart silently in wake-word mode
        // Guard: never restart if mic permission was denied
        if (micPermissionDenied) return;
        clearTimeout(wakeWordRestartTimer);
        wakeWordRestartTimer = setTimeout(() => {
            if (!micPermissionDenied && !isRecognitionRunning && !isStopped && !isAgentSpeaking) {
                wakeWordModeActive = true;
                startWakeWordListening();
                if (!isProcessing) setStatus('AI Ready', '#10b981');
            }
        }, 500);
    };
}

function startRecognition(lang = null) {
    if (!recognition || isRecognitionRunning || isStopped) return;
    recognition.lang = lang || activeSpeechLang;
    try {
        recognition.start();
        voiceEverStarted = true;
        stopBtn.classList.add('active');
    } catch(e) {
        // InvalidStateError = already started (race), ignore silently
        // NotAllowedError   = no user gesture, onerror will handle it
    }
}

function stopRecognition() {
    if (recognition) { try { recognition.abort(); } catch(e) {} }
    isRecognitionRunning = false;
}

// ── Language Sync ───────────────────────────────────────────
function syncLanguageUI(lang) {
    activeSpeechLang = lang;
    const isUrdu = lang === 'ur-PK';
    const langBtn = document.getElementById('lang-btn');
    if (langBtn) {
        langBtn.textContent = isUrdu ? 'UR' : 'EN';
        langBtn.style.color        = isUrdu ? 'var(--primary)' : '#f59e0b';
        langBtn.style.borderColor  = isUrdu ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.3)';
        langBtn.style.background   = isUrdu ? 'rgba(99,102,241,0.08)' : 'rgba(245,158,11,0.08)';
    }
    const homeLangToggle = document.getElementById('home-lang-toggle');
    if (homeLangToggle) homeLangToggle.textContent = isUrdu ? 'UR' : 'EN';
    const title = document.getElementById('voice-card-title');
    const sub   = document.getElementById('voice-card-sub');
    if (title) title.textContent = isUrdu ? 'بولیں (Urdu)' : 'Tap to Speak';
    if (sub)   sub.textContent   = isUrdu ? 'اردو · Roman Urdu · English' : 'English · Roman Urdu · اردو';
    if (userInput) userInput.placeholder = isUrdu ? 'اپنی ضرورت لکھیں...' : 'Type your request...';
}
syncLanguageUI(activeSpeechLang);

// Language toggle buttons
const langBtn = document.getElementById('lang-btn');
if (langBtn) langBtn.addEventListener('click', e => { e.stopPropagation(); syncLanguageUI(activeSpeechLang === 'ur-PK' ? 'en-US' : 'ur-PK'); });
const homeLangToggle = document.getElementById('home-lang-toggle');
if (homeLangToggle) homeLangToggle.addEventListener('click', e => { e.stopPropagation(); syncLanguageUI(activeSpeechLang === 'ur-PK' ? 'en-US' : 'ur-PK'); });

// Mic button — user tapped: switch from silent wake-word mode → active listening
// With continuous:true, recognition is already running. We just update the mode flag
// and show the active UI. NO restart = NO extra beep.
micBtn?.addEventListener('click', () => {
    attemptUnlockAudio();
    inputMode = 'voice';
    isStopped = false;
    micPermissionDenied = false; // User tapped mic — give permission another chance
    wakeWordModeActive = false; // Now accept all speech as commands

    if (!isRecognitionRunning && !isAgentSpeaking) {
        // Edge case: recognition stopped (e.g. after explicit stop or iOS timeout)
        startRecognition(activeSpeechLang);
    } else {
        // Already running in wake-word mode — just show the active UI
        micBtn.classList.add('listening');
        const voiceOrb = document.getElementById('voice-orb');
        if (voiceOrb) voiceOrb.classList.add('listening');
        setStatus('Listening... 🎙️', '#ef4444');
    }
});

// Voice card (the big mic card on Home tab)
// Tapping it switches to active voice mode and shows a clean listening state.
// We do NOT show the search/results panel here — that only appears after the
// user has finished speaking and processUserInput() is called.
const voiceSearchCard = document.getElementById('voice-search-card');
if (voiceSearchCard) {
    voiceSearchCard.addEventListener('click', () => {
        attemptUnlockAudio();
        inputMode = 'voice';
        isStopped = false;
        wakeWordModeActive = false; // Switch to active command mode (accept all speech)

        // Show active listening UI on the voice card itself
        const voiceCard2     = document.getElementById('voice-search-card');
        const voiceOrb       = document.getElementById('voice-orb');
        const voiceCardTitle = document.getElementById('voice-card-title');
        const voiceCardSub   = document.getElementById('voice-card-sub');
        if (voiceCard2) voiceCard2.classList.add('card-listening');
        if (voiceOrb)   voiceOrb.classList.add('listening');
        micBtn.classList.add('listening');
        setStatus('🎙️ Listening — speak now', '#ef4444');
        if (voiceCardTitle) voiceCardTitle.textContent = '🔴 Listening...';
        if (voiceCardSub)   voiceCardSub.textContent   = 'Speak your request in any language';

        // Reset card to idle state after 8s if nothing was spoken.
        // Store ref in outer-scope var so processUserInput() can cancel it.
        clearTimeout(voiceCardResetTimer);
        voiceCardResetTimer = setTimeout(() => {
            if (!isProcessing) {
                if (voiceCard2)     voiceCard2.classList.remove('card-listening');
                if (voiceCardTitle) voiceCardTitle.textContent = activeSpeechLang === 'ur-PK' ? 'بولیں (Urdu)' : 'Tap to Speak';
                if (voiceCardSub)   voiceCardSub.textContent   = activeSpeechLang === 'ur-PK' ? 'اردو · Roman Urdu · English' : 'English · Roman Urdu · اردو';
                if (voiceOrb) voiceOrb.classList.remove('listening');
                micBtn.classList.remove('listening');
                setStatus('AI Ready', '#10b981');
            }
        }, 8000);

        if (!isRecognitionRunning && !isAgentSpeaking) {
            startRecognition(activeSpeechLang);
        } else if (isRecognitionRunning) {
            // Already running in wake-word mode — just updated the mode flag above;
            // the UI is already showing active listening state, nothing else needed.
        }
    });
}

// ── Text input ──────────────────────────────────────────────
sendBtn.addEventListener('click', () => {
    const text = userInput.value.trim();
    if (text) {
        inputMode = 'text';
        attemptUnlockAudio(); // Unlock in gesture so voice responses can play if user switches
        userInput.value = '';
        processUserInput(text);
    }
});
userInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
        const text = userInput.value.trim();
        if (text) { inputMode = 'text'; userInput.value = ''; processUserInput(text); }
    }
});

// Service card clicks
document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', () => {
        const service = card.getAttribute('data-service');
        if (service) { inputMode = 'text'; processUserInput(`I need a ${service}`); }
    });
});

// ══════════════════════════════════════════════════════════════
// SEQUENTIAL NARRATION PLAYER
// Plays step texts one-by-one with barge-in support between each.
// This gives the feel of real-time reasoning narration.
// ══════════════════════════════════════════════════════════════
async function playNarration(stepTexts, stepAudios, lang) {
    const texts  = (stepTexts  && stepTexts.length  > 0) ? stepTexts  : [];
    const audios = (stepAudios && stepAudios.length > 0) ? stepAudios : [];

    if (texts.length === 0) return;

    for (let i = 0; i < texts.length; i++) {
        if (isStopped || pendingBargeInText) break;
        const audio = audios[i] || null;
        await speak(texts[i], audio, lang);
        // Short pause between narration steps so they feel distinct
        if (i < texts.length - 1 && !isStopped && !pendingBargeInText) {
            await new Promise(r => setTimeout(r, 250));
        }
    }
}

// ══════════════════════════════════════════════════════════════
// CORE: PROCESS USER INPUT
// Unified handler for ALL inputs (text, voice, service card)
// ══════════════════════════════════════════════════════════════
async function processUserInput(text) {
    if (!text || isProcessing) return;
    isProcessing = true;
    isStopped    = false;

    // NOTE: We do NOT auto-change activeSpeechLang here — user controls mic language via lang toggle.
    // Speech recognition stays in whatever language the user set. Only TTS changes with content.

    // Show user message in Chat tab
    appendMessage(text, 'user-message');

    // Reset pipeline state (visual nodes) — user can tap Pipeline tab to see it
    // We do NOT auto-switch tabs — it breaks scroll state and disrupts the user
    resetPipeline();
    if (!map) setTimeout(initMap, 150);

    // Searching spinner on Home
    const homeResults    = document.getElementById('home-results');
    const searchingState = document.getElementById('searching-state');
    const searchingText  = document.getElementById('searching-text');
    const providerList   = document.getElementById('matched-providers-list');
    if (homeResults && searchingState) {
        homeResults.style.display    = 'block';
        searchingState.style.display = 'flex';
        if (searchingText) searchingText.textContent = '🧠 AI is reasoning...';
        if (providerList)  providerList.innerHTML = '';
    }

    // Cancel the 8s idle-reset timer — user spoke, so we handle the card state ourselves
    clearTimeout(voiceCardResetTimer);
    voiceCardResetTimer = null;
    // Reset voice card to processing state (no longer listening, now thinking)
    const voiceCardEl = document.getElementById('voice-search-card');
    const voiceOrbEl  = document.getElementById('voice-orb');
    if (voiceCardEl) voiceCardEl.classList.remove('card-listening');
    if (voiceOrbEl)  voiceOrbEl.classList.remove('listening');

    const typingDiv = appendMessage('⚙️ Thinking deeply...', 'bot-message');
    setStatus('🧠 Reasoning...', '#f59e0b');
    stopBtn.classList.add('active');

    try {
        const response = await fetch('/api/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userInput:  text,
                state:      { sessionId },
                userLocation,
                sessionId
            })
        });

        const data = await response.json();

        // Update session ID from server
        if (data.sessionId) sessionId = data.sessionId;

        typingDiv.remove();
        stopBtn.classList.remove('active');
        setStatus('AI Ready', '#10b981');

        const isUrdu = data.intent && (data.intent.language === 'URDU_SCRIPT' || data.intent.language === 'ROMAN_URDU');
        lastDetectedLang = data.intent?.language || 'ENGLISH';
        // Auto-follow language: if Gemini detects Urdu → switch mic to ur-PK for next input
        // If Gemini detects English → switch mic back to en-US
        // This makes the conversation naturally bilingual — Fixr mirrors whatever language user uses
        const detectedSpeechLang = isUrdu ? 'ur-PK' : 'en-US';
        if (activeSpeechLang !== detectedSpeechLang) {
            syncLanguageUI(detectedSpeechLang);
        }

        // Render agent trace in pipeline tab — non-blocking (don't await)
        if (data.trace && data.trace.length > 0) {
            updateTrace(data.trace, null, null, isUrdu); // intentionally not awaited
        }

        const action = data.state?.lastAction || data.intent?.action || '';

        const ttsLang = isUrdu ? 'ur-PK' : 'en-US';

        // ── Handle CALL action ──────────────────────────────
        if (action === 'CALL' || data.callResult?.action === 'INITIATE_CALL') {
            const callRes = data.callResult;
            const allProviders = (data.rankedProviders && data.rankedProviders.length > 0)
                ? data.rankedProviders
                : (data.state?.recommendedProvider ? [data.state.recommendedProvider] : []);
            const provider = allProviders[0] || { name: callRes?.provider || 'Provider', phone: callRes?.phone };
            const provPhone = provider.phone || callRes?.phone || null;
            appendMessage(data.reply, 'bot-message');
            if (provPhone) {
                appendCallCard({ ...provider, phone: provPhone }, chatContainer);
                if (providerList) providerList.innerHTML = buildCallCard({ ...provider, phone: provPhone }, provPhone.replace(/[^0-9+]/g, ''));
            }
            // Only speak if user is in voice mode (mic input) — text input stays silent
            if (inputMode === 'voice') {
                await playNarration(data.stepTexts, data.stepAudios, ttsLang);
                scheduleAutoListen(isUrdu);
            }

        // ── Handle BOOKING ──────────────────────────────────
        } else if (action === 'BOOKING' || data.booking) {
            appendMessage(data.reply, 'bot-message');
            const bookingProvider = (data.rankedProviders && data.rankedProviders.length > 0)
                ? data.rankedProviders[0]
                : (data.state?.recommendedProvider || null);
            if (data.booking) {
                appendProviderCard(bookingProvider, data.booking, false);
                updateDashboard(bookingProvider, data.booking, false);
            }
            if (searchingState) searchingState.style.display = 'none';
            if (inputMode === 'voice') {
                await playNarration(data.stepTexts, data.stepAudios, ttsLang);
                scheduleAutoListen(isUrdu);
            }

        // ── Handle provider search results ──────────────────
        } else if (data.rankedProviders && data.rankedProviders.length > 0) {
            appendMessage(data.reply, 'bot-message');
            appendProviderChoices(data.rankedProviders, isUrdu);
            renderHomeProviders(data.rankedProviders, providerList, isUrdu);
            if (searchingState) searchingState.style.display = 'none';
            if (inputMode === 'voice') {
                await playNarration(data.stepTexts, data.stepAudios, ttsLang);
                scheduleAutoListen(isUrdu);
            }

        // ── Conversational reply (no tool called) ──────────
        } else {
            const reply = data.reply || (isUrdu ? 'کوئی provider نہیں ملا۔ دوسری request کریں۔' : 'No providers found. Try again.');
            appendMessage(reply, 'bot-message');
            if (searchingState) searchingState.style.display = 'none';
            if (inputMode === 'voice') {
                await playNarration(data.stepTexts && data.stepTexts.length > 0
                    ? data.stepTexts
                    : [data.voiceResponse || reply],
                    data.stepAudios, ttsLang);
                scheduleAutoListen(isUrdu);
            }
        }

        // Stay on whatever tab the user is currently on — no disruptive tab jumping

    } catch (err) {
        typingDiv.remove();
        stopBtn.classList.remove('active');
        setStatus('Error ⚠️', '#ef4444');
        appendMessage('❌ Server error. Is the server running on port 3005?', 'bot-message');
        if (searchingState) searchingState.style.display = 'none';
        console.error('[processUserInput]', err);
    }

    isProcessing = false;

    // Text mode: go back to silent wake-word listening
    if (inputMode === 'text' && !isStopped && !isRecognitionRunning && !isAgentSpeaking) {
        wakeWordModeActive = true;
        startWakeWordListening();
    }

    // Process any barge-in text that was queued while we were busy
    if (pendingBargeInText && !isStopped) {
        const queued = pendingBargeInText;
        pendingBargeInText = null;
        processUserInput(queued);
    }
}

// Auto-listen after agent speaks (for barge-in on follow-up questions)
function scheduleAutoListen(isUrdu) {
    // After TTS finishes, re-open the mic via restartListeningAfterSpeech()
    // which already handles the 1.2s decay buffer and mode selection.
    restartListeningAfterSpeech(isUrdu);
}

// ══════════════════════════════════════════════════════════════
// HOME PROVIDER CARDS
// ══════════════════════════════════════════════════════════════
function renderHomeProviders(providers, container, isUrdu) {
    if (!container) return;
    container.innerHTML = '';
    providers.slice(0, 3).forEach((p, i) => {
        const isTop      = i === 0;
        const cleanPhone = (p.phone || '923001234567').replace(/[^0-9]/g, '');
        const card       = document.createElement('div');
        card.className   = 'home-provider-card';
        if (isTop) { card.style.borderColor = '#f59e0b'; card.style.background = 'rgba(245,158,11,0.06)'; }
        card.innerHTML = `
            <div class="home-provider-info" style="flex:1;">
                ${isTop ? '<span style="font-size:0.6rem;background:rgba(245,158,11,0.2);color:#f59e0b;padding:2px 7px;border-radius:10px;font-weight:700;display:inline-block;margin-bottom:5px;">🏆 AI PICK</span>' : ''}
                <h4 style="color:var(--text);">${p.name}</h4>
                <p style="margin-top:3px;color:var(--text-dim);">⭐ ${p.rating || 4.7} &nbsp;•&nbsp; 📍 ${p.distance ? p.distance + ' km' : 'Nearby'}${p.phone ? ' &nbsp;•&nbsp; 📞 ' + p.phone : ''}</p>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0;">
                <div style="display:flex;gap:6px;">
                    ${p.phone ? `<a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent('Salam, Fixr App se aap ka number mila hai.')}" target="_blank" style="background:#25d366;color:white;padding:6px 10px;border-radius:9px;font-size:0.7rem;font-weight:700;text-decoration:none;">💬</a>` : ''}
                    ${p.phone ? `<a href="tel:${p.phone}" style="background:#10b981;color:white;padding:6px 10px;border-radius:9px;font-size:0.7rem;font-weight:700;text-decoration:none;">📞</a>` : ''}
                </div>
                <button class="book-provider-btn" data-name="${p.name}" style="background:${isTop ? '#6366f1' : 'rgba(0,0,0,0.06)'};color:${isTop ? 'white' : 'var(--text)'};border:1px solid ${isTop ? '#6366f1' : 'rgba(0,0,0,0.1)'};padding:5px 12px;border-radius:9px;font-size:0.72rem;font-weight:700;cursor:pointer;">
                    ${isUrdu ? 'بک کریں' : 'Book'}
                </button>
            </div>`;
        container.appendChild(card);
    });

    // Book buttons → voice input with session context
    container.querySelectorAll('.book-provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.getAttribute('data-name');
            inputMode = 'text'; // Button tap = text mode
            processUserInput(lastDetectedLang === 'ROMAN_URDU' ? `Haan, ${name} ko book kar do` : `Book ${name}`);
        });
    });
}

// ══════════════════════════════════════════════════════════════
// PIPELINE TRACE RENDERER
// ══════════════════════════════════════════════════════════════
async function updateTrace(trace, stepAudios = null, stepTexts = null, isUrdu = false) {
    if (!traceContent) return;
    traceContent.innerHTML = '';

    const timerEl  = document.getElementById('trace-timer');
    const startMs  = Date.now();
    let   timerInt = setInterval(() => { if (timerEl) timerEl.textContent = ((Date.now() - startMs)/1000).toFixed(1) + 's'; }, 100);

    const agentColors = {
        'Intent Agent':    'var(--agent-intent)',
        'Discovery Agent': 'var(--agent-discovery)',
        'Ranking Agent':   'var(--agent-ranking)',
        'Booking Agent':   'var(--agent-booking)',
        'Follow-up Agent': 'var(--agent-followup)',
        'Orchestrator':    'var(--agent-orch)',
    };

    let arrowIdx = 1;
    for (let idx = 0; idx < trace.length; idx++) {
        const entry = trace[idx];
        const color = agentColors[entry.agent] || 'var(--agent-orch)';

        const nodeKey = AGENT_NODE_MAP[entry.agent];
        if (nodeKey) {
            setPipelineNode(nodeKey, 'running');
            if (nodeKey === 'discovery')  setPipelineArrow(1, true);
            if (nodeKey === 'ranking')    setPipelineArrow(2, true);
            if (nodeKey === 'booking')    setPipelineArrow(3, true);
            if (nodeKey === 'followup')   setPipelineArrow(4, true);
        }

        const el = document.createElement('div');
        el.className = 'trace-entry';
        el.style.cssText = `border-left-color:${color};opacity:0;transform:translateY(10px);transition:all 0.4s ease;`;

        let reasoningHtml = '';
        if (Array.isArray(entry.reasoning) && entry.reasoning.length > 0) {
            reasoningHtml = `<div class="trace-reasoning"><ul>${entry.reasoning.filter(Boolean).map(s => `<li>${s}</li>`).join('')}</ul></div>`;
        } else if (typeof entry.reasoning === 'string') {
            reasoningHtml = `<div class="trace-reasoning"><ul><li>${entry.reasoning}</li></ul></div>`;
        }

        const durationHtml = entry.processingMs
            ? `<span class="trace-ms">⏱ ${entry.processingMs}ms</span>` : '';
        const statusBadge = entry.status
            ? `<span class="trace-status-badge" style="background:${color}22;color:${color};border:1px solid ${color}44;">${entry.status}</span>` : '';

        el.innerHTML = `
            <div class="trace-entry-header">
                <span class="trace-agent-name" style="color:${color};">🤖 ${entry.agent}</span>
                <div class="trace-agent-badges">${durationHtml}${statusBadge}</div>
            </div>
            ${reasoningHtml}`;

        traceContent.appendChild(el);
        await new Promise(r => setTimeout(r, 60));
        el.style.opacity   = '1';
        el.style.transform = 'translateY(0)';
        traceContent.scrollTop = traceContent.scrollHeight;

        if (nodeKey) {
            const s = (entry.status === 'SUCCESS' || entry.status === 'COMPLETED') ? 'success'
                    : (entry.status === 'ERROR' || entry.status === 'FALLBACK')    ? 'error'
                    : (entry.status === 'RUNNING') ? 'running' : 'success';
            setTimeout(() => setPipelineNode(nodeKey, s), 350);
        }
    }

    clearInterval(timerInt);
    completePipeline('Gemini reasoning complete');
}

// ══════════════════════════════════════════════════════════════
// CHAT MESSAGE HELPERS
// ══════════════════════════════════════════════════════════════
function appendMessage(html, cls) {
    const chatList = chatContainer;
    if (!chatList) return document.createElement('div');
    const div = document.createElement('div');
    div.className = 'message ' + cls;
    div.innerHTML = html;
    div.style.animation = 'msgFadeIn 0.3s ease-out';
    chatList.appendChild(div);
    chatList.scrollTop = chatList.scrollHeight;
    return div;
}

function appendProviderChoices(providers, isUrdu) {
    if (!providers || providers.length === 0) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px;';
    providers.slice(0, 3).forEach((p, i) => {
        const card = document.createElement('div');
        card.style.cssText = `background:var(--card);border:1px solid ${i === 0 ? 'rgba(245,158,11,0.3)' : 'var(--card-border)'};border-radius:12px;padding:10px 12px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;`;
        card.innerHTML = `
            <div style="font-weight:700;color:var(--text);">${i === 0 ? '🏆 ' : ''}${p.name}</div>
            <div style="color:var(--text-dim);margin-top:2px;">⭐ ${p.rating || 4.7} • 📍 ${p.distance ? p.distance + ' km' : 'Nearby'}${p.phone ? ' • 📞 ' + p.phone : ''}</div>`;
        card.addEventListener('click', () => { inputMode = 'text'; processUserInput(isUrdu ? `Haan ${p.name} ko book kar do` : `Book ${p.name}`); });
        wrap.appendChild(card);
    });
    chatContainer.appendChild(wrap);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendProviderCard(provider, booking, autoBook) {
    if (!provider && !booking) return;
    const name    = provider?.name || booking?.provider?.name || 'Provider';
    const eta     = booking?.etaMinutes || 25;
    const cost    = booking?.cost?.total || '?';
    const bookId  = booking?.confirmationId || booking?.bookingId || 'BK-' + Date.now().toString(36).toUpperCase();
    bookingCount++;
    if (statBookings) statBookings.textContent = bookingCount;

    const card = document.createElement('div');
    card.className = 'provider-card';
    card.style.cssText = 'background:var(--card);border:1px solid rgba(16,185,129,0.3);border-radius:16px;padding:14px;margin-top:6px;';
    card.innerHTML = `
        <div style="font-weight:800;font-size:1rem;color:var(--text);">✅ ${name}</div>
        <div style="color:var(--text-dim);font-size:0.8rem;margin-top:6px;">🚗 ETA: ${eta} min &nbsp;•&nbsp; 💰 PKR ${cost} &nbsp;•&nbsp; 🎫 ${bookId}</div>
        <div style="display:flex;gap:8px;margin-top:10px;">
            <button onclick="processUserInput('Track ${name}')" style="flex:1;padding:8px;border-radius:10px;border:none;background:var(--primary);color:white;font-weight:700;font-size:0.78rem;cursor:pointer;">📍 Track</button>
            <button onclick="processUserInput('Call ${name}')" style="flex:1;padding:8px;border-radius:10px;border:none;background:#10b981;color:white;font-weight:700;font-size:0.78rem;cursor:pointer;">📞 Call</button>
            <button onclick="openRatingModal('${bookId}')" style="flex:1;padding:8px;border-radius:10px;border:none;background:rgba(0,0,0,0.06);color:var(--text);border:1px solid rgba(0,0,0,0.1);font-weight:700;font-size:0.78rem;cursor:pointer;">⭐ Rate</button>
        </div>`;
    chatContainer.appendChild(card);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendCallCard(provider, container) {
    const phone = (provider.phone || '03001234567').replace(/[^0-9+]/g, '');
    const card  = document.createElement('div');
    card.style.cssText = 'background:var(--card);border:1px solid rgba(99,102,241,0.3);border-radius:16px;padding:14px;margin-top:6px;text-align:center;';
    card.innerHTML = `
        <div style="font-size:2rem;margin-bottom:8px;">📞</div>
        <div style="font-weight:800;color:var(--text);">${provider.name}</div>
        <div style="color:var(--text-dim);font-size:0.8rem;margin:4px 0;">${phone || 'No number'}</div>
        ${phone ? `<a href="tel:${phone}" style="display:block;margin-top:10px;padding:10px;border-radius:12px;background:var(--primary);color:white;font-weight:700;text-decoration:none;">Call Now</a>` : ''}`;
    container.appendChild(card);
    container.scrollTop = container.scrollHeight;
}

function buildCallCard(provider, phone) {
    return `<div class="home-provider-card" style="border-color:rgba(99,102,241,0.3);flex-direction:column;align-items:center;text-align:center;gap:10px;">
        <div style="font-size:2.5rem;">📞</div>
        <div>
            <div style="font-weight:800;color:var(--text);">${provider.name}</div>
            <div style="color:var(--text-dim);font-size:0.8rem;">${phone || 'No number'}</div>
        </div>
        ${phone ? `<a href="tel:${phone}" style="display:block;width:100%;padding:12px;border-radius:14px;background:var(--primary);color:white;font-weight:700;text-decoration:none;font-size:0.9rem;">📞 Call Now</a>` : ''}
    </div>`;
}

function updateDashboard(provider, booking, autoBook) {
    if (!activeBookingCard || !booking) return;
    const name = provider?.name || booking?.provider?.name || 'Provider';
    const eta  = booking?.etaMinutes || 25;
    activeBookingCard.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-weight:800;color:var(--text);font-size:0.95rem;">✅ ${name}</span>
            <span style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:3px 10px;border-radius:20px;font-size:0.65rem;font-weight:700;">CONFIRMED</span>
        </div>
        <div style="color:var(--text-dim);font-size:0.78rem;">🚗 Arriving in ~${eta} min</div>
        <div style="display:flex;gap:8px;margin-top:10px;">
            <button onclick="processUserInput('How far is ${name}')" style="flex:1;padding:8px;border-radius:10px;border:none;background:var(--primary);color:white;font-weight:700;font-size:0.75rem;cursor:pointer;">📍 Track</button>
            <button onclick="processUserInput('Cancel booking')" style="flex:1;padding:8px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#ef4444;font-weight:700;font-size:0.75rem;cursor:pointer;">Cancel</button>
        </div>`;
}

window.openRatingModal = function(bookingId) {
    const rating  = prompt('Rate your experience (1-5):', '5');
    const comment = prompt('Any comments?', 'Great service!');
    if (rating) {
        fetch('/api/rate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ bookingId, rating: parseInt(rating), comment }) })
            .then(r => r.json()).then(d => appendMessage(d.message || 'Rating submitted!', 'bot-message'));
    }
};

// DIY Video Modal
const diySteps = [
    { text: "<b>Expert:</b> Remote se settings check karein. Is it on 'Cool' mode at 16°?" },
    { text: "<b>Expert:</b> Indoor unit ke filter nikalein aur dho lein." },
    { text: "<b>Expert:</b> Outdoor unit ka fan check karein." },
    { text: "<b>Expert:</b> Gas leak lag raha hai. Main aa raha hoon." },
];
let diyStep = 0;
function openDiyModal() {
    diyStep = 0;
    if (diyStepText) diyStepText.innerHTML = diySteps[0].text;
    if (diyModal) diyModal.classList.add('active');
}
if (closeModal) closeModal.addEventListener('click', () => diyModal?.classList.remove('active'));
if (nextStepBtn) nextStepBtn.addEventListener('click', () => {
    diyStep = Math.min(diyStep + 1, diySteps.length - 1);
    if (diyStepText) diyStepText.innerHTML = diySteps[diyStep].text;
});
if (prevStepBtn) prevStepBtn.addEventListener('click', () => {
    diyStep = Math.max(diyStep - 1, 0);
    if (diyStepText) diyStepText.innerHTML = diySteps[diyStep].text;
});
