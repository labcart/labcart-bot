import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

/**
 * OpenAI Whisper Transcription Provider
 *
 * Supports dynamic API keys passed per-request, with ENV fallback.
 * Pass apiKey in method params to use a specific key, otherwise
 * falls back to OPENAI_API_KEY environment variable.
 */
export class OpenAIWhisperProvider {
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
        console.log('   No ENV key - using api_keys.openai from requests');
        return false;
      }

      this.client = new OpenAI({ apiKey });

      console.log('   OpenAI Whisper initialized with ENV key');
      return true;
    } catch (error) {
      console.error('   Failed to initialize OpenAI Whisper:', error.message);
      throw new Error(`OpenAI Whisper initialization failed: ${error.message}`);
    }
  }

  /**
   * Transcribe audio/video file to text
   *
   * @param {Object} params
   * @param {string} params.file_path - Path to the audio/video file
   * @param {string} [params.language] - Language code (e.g., 'en', 'es', 'fr') - auto-detected if not provided
   * @param {string} [params.prompt] - Optional prompt to guide transcription style
   * @param {string} [params.response_format] - Output format: json, text, srt, vtt, verbose_json
   * @param {number} [params.temperature] - Sampling temperature (0-1)
   * @param {boolean} [params.timestamps] - Include word-level timestamps (uses verbose_json)
   * @param {string} [params.apiKey] - Optional API key (falls back to ENV)
   * @returns {Promise<Object>} Transcription result
   */
  async transcribe({ file_path, language, prompt, response_format, temperature, timestamps, apiKey }) {
    // Get client with provided key or ENV fallback
    const client = this.getClient(apiKey);

    const model = this.config.model || 'whisper-1';
    const format = timestamps ? 'verbose_json' : (response_format || this.config.response_format || 'json');
    const temp = temperature !== undefined ? temperature : this.config.temperature;

    // Verify file exists
    if (!fs.existsSync(file_path)) {
      throw new Error(`File not found: ${file_path}`);
    }

    // Check file size (Whisper max is 25MB)
    const stats = fs.statSync(file_path);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 25) {
      throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB. Maximum is 25MB.`);
    }

    try {
      const fileStream = fs.createReadStream(file_path);

      const requestParams = {
        file: fileStream,
        model,
        response_format: format,
      };

      // Add optional parameters
      if (language) requestParams.language = language;
      if (prompt) requestParams.prompt = prompt;
      if (temp !== undefined) requestParams.temperature = temp;

      console.log(`   Transcribing: ${path.basename(file_path)} (${fileSizeMB.toFixed(2)}MB)`);

      const response = await client.audio.transcriptions.create(requestParams, {
        timeout: 300000 // 5 minute timeout for large files
      });

      // Parse response based on format
      let text, duration, words, segments;

      if (format === 'text') {
        text = response;
      } else if (format === 'verbose_json') {
        text = response.text;
        duration = response.duration;
        words = response.words;
        segments = response.segments;
      } else {
        text = response.text;
      }

      return {
        success: true,
        text,
        duration_seconds: duration,
        words: words || null,
        segments: segments || null,
        language: response.language || language || 'auto-detected',
        provider: 'openai',
        model_used: model,
        file_size_mb: fileSizeMB,
        response_format: format
      };
    } catch (error) {
      console.error('  OpenAI Whisper transcription failed:', error.message);
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  /**
   * Translate audio to English text
   *
   * @param {Object} params
   * @param {string} params.file_path - Path to the audio/video file
   * @param {string} [params.prompt] - Optional prompt to guide translation style
   * @param {string} [params.response_format] - Output format: json, text, srt, vtt, verbose_json
   * @param {number} [params.temperature] - Sampling temperature (0-1)
   * @param {string} [params.apiKey] - Optional API key (falls back to ENV)
   * @returns {Promise<Object>} Translation result
   */
  async translate({ file_path, prompt, response_format, temperature, apiKey }) {
    // Get client with provided key or ENV fallback
    const client = this.getClient(apiKey);

    const model = this.config.model || 'whisper-1';
    const format = response_format || this.config.response_format || 'json';
    const temp = temperature !== undefined ? temperature : this.config.temperature;

    // Verify file exists
    if (!fs.existsSync(file_path)) {
      throw new Error(`File not found: ${file_path}`);
    }

    // Check file size
    const stats = fs.statSync(file_path);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 25) {
      throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB. Maximum is 25MB.`);
    }

    try {
      const fileStream = fs.createReadStream(file_path);

      const requestParams = {
        file: fileStream,
        model,
        response_format: format,
      };

      if (prompt) requestParams.prompt = prompt;
      if (temp !== undefined) requestParams.temperature = temp;

      console.log(`   Translating to English: ${path.basename(file_path)} (${fileSizeMB.toFixed(2)}MB)`);

      const response = await client.audio.translations.create(requestParams, {
        timeout: 300000
      });

      let text = format === 'text' ? response : response.text;

      return {
        success: true,
        text,
        target_language: 'en',
        provider: 'openai',
        model_used: model,
        file_size_mb: fileSizeMB,
        response_format: format
      };
    } catch (error) {
      console.error('  OpenAI Whisper translation failed:', error.message);
      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  /**
   * Get supported formats
   */
  getSupportedFormats() {
    return {
      input: ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'],
      output: ['json', 'text', 'srt', 'vtt', 'verbose_json']
    };
  }
}

export default OpenAIWhisperProvider;
