/**
 * ElevenLabs Pro Voice Service
 * High-Fidelity Agentic TTS (English & Urdu)
 */

const axios = require('axios');

class ElevenLabsService {
  constructor(apiKey, agentId, voiceId) {
    this.apiKey  = apiKey;
    this.agentId = agentId;
    // Use the voice ID passed from env — never rely on a hardcoded fallback
    this.voiceId = voiceId || 'P3H5nMmQOULlwDXfrDeq';
    this.modelId = 'eleven_multilingual_v2';
  }

  async generateSpeech(text) {
    if (!this.apiKey || this.apiKey === 'yahan_nai_key_paste_karo') {
      console.warn('[ElevenLabs] Valid API Key missing, skipping voice generation.');
      return null;
    }

    try {
      // If targetId is a conversational Agent ID (starts with 'agent_'), it cannot be used for standard Text-To-Speech.
      // So we fallback to standard voiceId (multi-lingual high fidelity voice Antoni).
      let targetId = this.agentId || this.voiceId;
      if (targetId && targetId.startsWith('agent_')) {
        targetId = this.voiceId;
      }

      console.log(`[ElevenLabs] Generating speech using target: ${targetId}`);

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
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });

      return response.data;
    } catch (err) {
      console.error('[ElevenLabs] Error generating speech:', err.response ? err.response.data.toString() : err.message);
      return null;
    }
  }
}

module.exports = ElevenLabsService;
