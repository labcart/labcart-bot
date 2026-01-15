import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Google Cloud Text-to-Speech Provider
 *
 * Supports dynamic credentials passed per-request, with ENV fallback.
 * Pass credentials (JSON object) in method params, otherwise
 * falls back to GOOGLE_APPLICATION_CREDENTIALS environment variable.
 */
export class GoogleTTSProvider {
  constructor(config) {
    this.config = config;
    this.client = null;  // Default client using ENV credentials
  }

  /**
   * Get a Google Cloud TTS client instance
   * @param {Object} [credentials] - Optional credentials JSON object (uses ENV if not provided)
   * @returns {textToSpeech.TextToSpeechClient} Google Cloud TTS client instance
   */
  getClient(credentials) {
    // If credentials provided, create client with them
    if (credentials) {
      return new textToSpeech.TextToSpeechClient({ credentials });
    }

    // If we have a cached client from ENV, return it
    if (this.client) {
      return this.client;
    }

    // Check if ENV credentials are configured
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('No credentials provided. Pass api_keys.google (credentials JSON) in request or set GOOGLE_APPLICATION_CREDENTIALS environment variable.');
    }

    // Create client using ENV credentials (will be cached on first successful init)
    return new textToSpeech.TextToSpeechClient();
  }

  /**
   * Initialize the default Google Cloud TTS client (for ENV-based usage)
   */
  async initialize() {
    try {
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.log('ℹ️  No ENV key - using api_keys.google from requests');
        return false;
      }

      this.client = new textToSpeech.TextToSpeechClient();

      // Test credentials by making a minimal API call
      await this.client.listVoices({});

      console.log('✅ Google Cloud TTS initialized with ENV credentials');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Google Cloud TTS:', error.message);
      throw new Error(`Google Cloud TTS initialization failed: ${error.message}`);
    }
  }

  /**
   * Generate speech from text
   *
   * @param {Object} params
   * @param {string} params.text - Text to convert to speech
   * @param {string} [params.voice] - Voice name (overrides config)
   * @param {number} [params.speed] - Speaking rate (0.25-4.0)
   * @param {string} [params.filename] - Custom filename prefix (timestamp will be appended)
   * @param {Object} [params.credentials] - Optional Google credentials JSON (falls back to ENV)
   * @returns {Promise<Object>} Audio data and metadata
   */
  async generateSpeech({ text, voice, speed, filename, credentials }) {
    // Get client with provided credentials or ENV fallback
    const client = this.getClient(credentials);

    const request = {
      input: { text },
      voice: {
        languageCode: this.config.language_code || 'en-US',
        name: voice || this.config.voice || 'en-US-Neural2-F'
      },
      audioConfig: {
        audioEncoding: this.config.audio_encoding || 'MP3',
        speakingRate: speed || this.config.speaking_rate || 1.0,
        pitch: this.config.pitch || 0.0
      }
    };

    try {
      const [response] = await client.synthesizeSpeech(request);

      // Generate filename with optional custom prefix
      const timestamp = Date.now();

      // Sanitize custom filename if provided (remove dangerous characters)
      let filePrefix = 'google-tts';
      if (filename) {
        filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
      }

      const generatedFilename = `${filePrefix}-${timestamp}.mp3`;
      const outputDir = path.resolve(process.cwd(), this.config.output_dir || './audio-output');
      const filePath = path.join(outputDir, generatedFilename);

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      // Write audio file
      await fs.writeFile(filePath, response.audioContent, 'binary');

      // Convert to base64 for optional embedding
      const base64Audio = response.audioContent.toString('base64');

      return {
        success: true,
        audio_path: filePath,
        audio_base64: base64Audio,
        format: 'mp3',
        character_count: text.length,
        provider: 'google',
        voice_used: request.voice.name,
        file_size_bytes: response.audioContent.length
      };
    } catch (error) {
      console.error('❌ Google TTS generation failed:', error.message);
      throw new Error(`Speech generation failed: ${error.message}`);
    }
  }

  /**
   * List available voices
   * @param {string} [languageCode] - Language code filter (default: en-US)
   * @param {Object} [credentials] - Optional Google credentials JSON (falls back to ENV)
   */
  async listVoices(languageCode = 'en-US', credentials) {
    // Get client with provided credentials or ENV fallback
    const client = this.getClient(credentials);

    try {
      const [response] = await client.listVoices({ languageCode });
      return response.voices.map(voice => ({
        name: voice.name,
        gender: voice.ssmlGender,
        languages: voice.languageCodes
      }));
    } catch (error) {
      console.error('❌ Failed to list voices:', error.message);
      return [];
    }
  }
}

export default GoogleTTSProvider;
