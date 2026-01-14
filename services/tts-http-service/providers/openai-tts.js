import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * OpenAI Text-to-Speech Provider
 *
 * Supports dynamic API keys passed per-request, with ENV fallback.
 * Pass apiKey in method params to use a specific key, otherwise
 * falls back to OPENAI_API_KEY environment variable.
 */
export class OpenAITTSProvider {
  constructor(config) {
    this.config = config;
    this.client = null;  // Default client using ENV key
  }

  /**
   * Get an OpenAI client instance
   * @param {string} [apiKey] - Optional API key (uses ENV if not provided)
   * @returns {OpenAI} OpenAI client instance
   */
  getClient(apiKey) {
    const key = apiKey || process.env.OPENAI_API_KEY;

    if (!key) {
      throw new Error('No API key provided. Pass api_keys.openai in request or set OPENAI_API_KEY environment variable.');
    }

    // If using ENV key and we have a cached client, return it
    if (!apiKey && this.client) {
      return this.client;
    }

    // Create new client with the provided key
    return new OpenAI({ apiKey: key });
  }

  /**
   * Initialize the default OpenAI client (for ENV-based usage)
   */
  async initialize() {
    try {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        console.warn('⚠️  OPENAI_API_KEY not set - will require api_keys.openai in requests');
        return false;
      }

      this.client = new OpenAI({ apiKey });

      console.log('✅ OpenAI TTS initialized with ENV key');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize OpenAI TTS:', error.message);
      throw new Error(`OpenAI TTS initialization failed: ${error.message}`);
    }
  }

  /**
   * Generate speech from text
   *
   * @param {Object} params
   * @param {string} params.text - Text to convert to speech
   * @param {string} [params.voice] - Voice name (alloy, echo, fable, onyx, nova, shimmer)
   * @param {number} [params.speed] - Speaking rate (0.25-4.0)
   * @param {string} [params.filename] - Custom filename prefix (timestamp will be appended)
   * @param {string} [params.apiKey] - Optional API key (falls back to ENV)
   * @returns {Promise<Object>} Audio data and metadata
   */
  async generateSpeech({ text, voice, speed, filename, apiKey }) {
    // Get client with provided key or ENV fallback
    const client = this.getClient(apiKey);

    const model = this.config.model || 'tts-1';
    const voiceName = voice || this.config.voice || 'nova';
    const speedValue = speed || this.config.speed || 1.0;

    try {
      // Add timeout to prevent hanging on slow/unresponsive API calls
      const timeout = 30000; // 30 seconds
      const apiCall = client.audio.speech.create({
        model,
        voice: voiceName,
        input: text,
        speed: speedValue,
        response_format: this.config.response_format || 'mp3'
      }, {
        timeout: timeout
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`OpenAI API timeout after ${timeout}ms`)), timeout + 1000)
      );

      const response = await Promise.race([apiCall, timeoutPromise]);

      // Generate filename with optional custom prefix
      const timestamp = Date.now();
      const format = this.config.response_format || 'mp3';

      // Sanitize custom filename if provided (remove dangerous characters)
      let filePrefix = 'openai-tts';
      if (filename) {
        filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
      }

      const generatedFilename = `${filePrefix}-${timestamp}.${format}`;
      const outputDir = path.resolve(process.cwd(), this.config.output_dir || './audio-output');
      const filePath = path.join(outputDir, generatedFilename);

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      // Get the audio data as a buffer
      const buffer = Buffer.from(await response.arrayBuffer());

      // Write audio file
      await fs.writeFile(filePath, buffer);

      // Convert to base64 for optional embedding
      const base64Audio = buffer.toString('base64');

      return {
        success: true,
        audio_path: filePath,
        audio_base64: base64Audio,
        format: format,
        character_count: text.length,
        provider: 'openai',
        model_used: model,
        voice_used: voiceName,
        file_size_bytes: buffer.length
      };
    } catch (error) {
      console.error('❌ OpenAI TTS generation failed:', error.message);
      throw new Error(`Speech generation failed: ${error.message}`);
    }
  }

  /**
   * List available voices
   */
  async listVoices() {
    // OpenAI has a fixed set of voices
    return [
      { name: 'alloy', description: 'Neutral and balanced' },
      { name: 'echo', description: 'Male voice' },
      { name: 'fable', description: 'British accent' },
      { name: 'onyx', description: 'Deep male voice' },
      { name: 'nova', description: 'Female voice' },
      { name: 'shimmer', description: 'Soft female voice' }
    ];
  }
}

export default OpenAITTSProvider;
