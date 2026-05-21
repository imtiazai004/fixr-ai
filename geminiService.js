/**
 * Gemini AI Service (Root)
 * Uses Google's Gemini 1.5 Flash for low-latency structured JSON extraction.
 * Supports multi-key rotation via GEMINI_API_KEYS in backend/.env
 */

// Reuse the SDK installed in backend/node_modules so we don't double-install
const { GoogleGenerativeAI } = require('./backend/node_modules/@google/generative-ai');

class GeminiService {
  constructor() {
    this.keys = [];
    if (process.env.GEMINI_API_KEYS) {
      this.keys = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
    } else if (process.env.GEMINI_API_KEY) {
      this.keys = [process.env.GEMINI_API_KEY];
    }
  }

  isReady() {
    return this.keys.length > 0;
  }

  /**
   * Generate a structured JSON response from a prompt.
   * Rotates through configured keys on quota/auth failures.
   */
  async generateJson(prompt, schema) {
    if (!this.isReady()) {
      throw new Error('No Gemini API keys configured (set GEMINI_API_KEYS in backend/.env)');
    }

    let lastError = null;

    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[i];
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({
          model: 'gemini-2.5-flash-lite',
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.2,
          },
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        if (i > 0) {
          console.log(`[Gemini] Recovered using key index ${i}`);
        }
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini] Key ${i} failed: ${err.message || err}`);
        // Continue to the next key on failure
      }
    }

    throw lastError || new Error('All Gemini API keys failed');
  }
}

module.exports = new GeminiService();
