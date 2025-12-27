import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Google Cloud Text-to-Speech Provider
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS environment variable
 * pointing to a service account JSON file.
 */
export class GoogleTTSProvider {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * Initialize the Google Cloud TTS client
   */
  async initialize() {
    try {
      this.client = new textToSpeech.TextToSpeechClient();

      // Test credentials by making a minimal API call
      await this.client.listVoices({});

      console.log('✅ Google Cloud TTS initialized successfully');
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
   * @returns {Promise<Object>} Audio data and metadata
   */
  async generateSpeech({ text, voice, speed, filename }) {
    if (!this.client) {
      await this.initialize();
    }

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
      const [response] = await this.client.synthesizeSpeech(request);

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
   */
  async listVoices(languageCode = 'en-US') {
    if (!this.client) {
      await this.initialize();
    }

    try {
      const [response] = await this.client.listVoices({ languageCode });
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
