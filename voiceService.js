/**
 * ElevenLabs Pro Voice Service
 * High-Fidelity Agentic TTS (English & Urdu)
 *
 * Pro-Max upgrade: native multi-key failover. ElevenLabs free/dev keys hit
 * their quota quickly; we rotate through every key in ELEVENLABS_API_KEYS and
 * retry on 401 (Unauthorized) / 429 (Quota Exceeded) so TTS never silently dies.
 */

const axios = require('axios');

const PLACEHOLDER_KEY = 'yahan_nai_key_paste_karo';

class ElevenLabsService {
  constructor(apiKey, agentId, voiceId) {
    // Primary source: comma-separated ELEVENLABS_API_KEYS (one OR many keys).
    // Fallback: the single key passed in, or ELEVENLABS_API_KEY — this keeps
    // the existing server.js constructor call working with no changes.
    const multiKeys = (process.env.ELEVENLABS_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
    const singleKey = (apiKey || process.env.ELEVENLABS_API_KEY || '').trim();

    this.apiKeys = (multiKeys.length > 0 ? multiKeys : (singleKey ? [singleKey] : []))
      .filter(k => k && k !== PLACEHOLDER_KEY);

    this.agentId = agentId;
    // Use the voice ID passed from env — never rely on a hardcoded fallback
    this.voiceId = voiceId || 'P3H5nMmQOULlwDXfrDeq';
    this.modelId = 'eleven_multilingual_v2';

    console.log(`[ElevenLabs] Initialized with ${this.apiKeys.length} API key(s) for failover.`);
  }

  async generateSpeech(text) {
    if (this.apiKeys.length === 0) {
      console.warn('[ElevenLabs] No valid API key configured, skipping voice generation.');
      return null;
    }
    if (!text || !text.trim()) return null;

    // If targetId is a conversational Agent ID (starts with 'agent_'), it cannot
    // be used for standard Text-To-Speech. So we fall back to the standard
    // voiceId (multi-lingual high-fidelity voice).
    let targetId = this.agentId || this.voiceId;
    if (targetId && targetId.startsWith('agent_')) {
      targetId = this.voiceId;
    }

    // ── Multi-Key Failover Loop ──────────────────────────────────────────────
    // Try each key in turn. On 401/429 the key is dead/quota'd — move to the
    // next one. On any other error, another key won't help, so we stop.
    for (let i = 0; i < this.apiKeys.length; i++) {
      const key = this.apiKeys[i];
      try {
        console.log(`[ElevenLabs] Generating speech (key #${i + 1}/${this.apiKeys.length}, target: ${targetId})`);

        const response = await axios({
          method: 'post',
          url: `https://api.elevenlabs.io/v1/text-to-speech/${targetId}`,
          data: {
            text: text,
            model_id: this.modelId,
            voice_settings: {
              stability: 0.4,
              similarity_boost: 0.8,
              style: 0.5,
              use_speaker_boost: true
            }
          },
          headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': key,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        });

        if (i > 0) {
          console.log(`[ElevenLabs] Recovered — succeeded with key #${i + 1}/${this.apiKeys.length}.`);
        }
        return response.data; // arraybuffer — caller converts to base64

      } catch (err) {
        const status = err.response && err.response.status;

        // 401 = Unauthorized, 429 = Quota Exceeded → rotate to the next key
        if (status === 401 || status === 429) {
          const reason = status === 429 ? 'quota exceeded' : 'unauthorized';
          console.warn(
            `[ElevenLabs] Key #${i + 1}/${this.apiKeys.length} failed ` +
            `(HTTP ${status} — ${reason}). ` +
            (i + 1 < this.apiKeys.length ? 'Retrying with next key...' : 'No keys left.')
          );
          continue; // try next key
        }

        // Any other error (network blip, 5xx, bad voice ID) will not be fixed
        // by swapping keys — log the detail and bail out.
        let detail = err.message;
        try {
          if (err.response && err.response.data) {
            detail = Buffer.from(err.response.data).toString('utf-8');
          }
        } catch (_) { /* keep err.message */ }
        console.error('[ElevenLabs] Non-recoverable error generating speech:', detail);
        return null;
      }
    }

    console.error(`[ElevenLabs] All ${this.apiKeys.length} API key(s) exhausted — voice generation failed.`);
    return null;
  }
}

module.exports = ElevenLabsService;
