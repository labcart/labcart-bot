import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ElevenLabs Text-to-Speech Provider
 *
 * Requires ELEVENLABS_API_KEY environment variable
 */
export class ElevenLabsTTSProvider {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * Initialize the ElevenLabs client
   */
  async initialize() {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;

      if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY environment variable not set');
      }

      this.client = new ElevenLabsClient({ apiKey });

      console.log('✅ ElevenLabs TTS initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize ElevenLabs TTS:', error.message);
      throw new Error(`ElevenLabs TTS initialization failed: ${error.message}`);
    }
  }

  /**
   * Generate speech from text
   *
   * @param {Object} params
   * @param {string} params.text - Text to convert to speech
   * @param {string} [params.voice] - Voice ID (from ElevenLabs voice library)
   * @param {number} [params.speed] - Speaking rate (0.7-1.2, clamped to ElevenLabs range)
   * @param {string} [params.filename] - Custom filename prefix (timestamp will be appended)
   * @returns {Promise<Object>} Audio data and metadata
   */
  async generateSpeech({ text, voice, speed, filename }) {
    if (!this.client) {
      await this.initialize();
    }

    const voiceId = voice || this.config.voice || 'EXAVITQu4vr4xnSDxMaL'; // Default: Bella
    const modelId = this.config.model || 'eleven_multilingual_v2';

    // ElevenLabs speed range is 0.7-1.2 (unlike OpenAI's 0.25-4.0)
    // Clamp incoming speed value to valid range
    let speedValue = speed || this.config.speed || 1.0;
    speedValue = Math.max(0.7, Math.min(1.2, speedValue));

    const voiceSettings = {
      stability: this.config.stability || 0.5,
      similarity_boost: this.config.similarity_boost || 0.75,
      speed: speedValue,
    };

    try {
      // Generate audio
      const audioStream = await this.client.textToSpeech.convert(voiceId, {
        text,
        model_id: modelId,
        voice_settings: voiceSettings,
        output_format: 'mp3_44100_128',
      });

      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Generate filename with optional custom prefix
      const timestamp = Date.now();
      const format = 'mp3';

      // Sanitize custom filename if provided (remove dangerous characters)
      let filePrefix = 'elevenlabs-tts';
      if (filename) {
        filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
      }

      const generatedFilename = `${filePrefix}-${timestamp}.${format}`;
      const outputDir = path.resolve(process.cwd(), this.config.output_dir || './audio-output');
      const filePath = path.join(outputDir, generatedFilename);

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

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
        provider: 'elevenlabs',
        model_used: modelId,
        voice_used: voiceId,
        file_size_bytes: buffer.length
      };
    } catch (error) {
      console.error('❌ ElevenLabs TTS generation failed:', error.message);
      throw new Error(`Speech generation failed: ${error.message}`);
    }
  }

  /**
   * List available voices from ElevenLabs
   *
   * @returns {Promise<Array>} List of available voices
   */
  async listVoices() {
    if (!this.client) {
      await this.initialize();
    }

    try {
      const response = await this.client.voices.getAll();

      return response.voices.map(voice => ({
        voice_id: voice.voice_id,
        name: voice.name,
        category: voice.category,
        description: voice.description || '',
        labels: voice.labels || {},
        preview_url: voice.preview_url,
      }));
    } catch (error) {
      console.error('❌ Failed to list ElevenLabs voices:', error.message);

      // Return some common premade voices as fallback
      return [
        { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', description: 'Young, friendly female' },
        { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Calm, clear female' },
        { voice_id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', description: 'Strong, confident female' },
        { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Deep, warm male' },
        { voice_id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Crisp, authoritative male' },
        { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Deep, resonant male' },
        { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', description: 'Young, energetic male' },
      ];
    }
  }

  /**
   * Search voices by tags/characteristics
   *
   * @param {Object} filters - Search filters
   * @param {string} [filters.gender] - male, female
   * @param {string} [filters.age] - young, middle_aged, old
   * @param {string} [filters.accent] - american, british, etc
   * @param {string} [filters.use_case] - narration, conversational, etc
   * @returns {Promise<Array>} Filtered voices
   */
  async searchVoices(filters = {}) {
    const allVoices = await this.listVoices();

    return allVoices.filter(voice => {
      if (!voice.labels) return true;

      let matches = true;

      if (filters.gender && voice.labels.gender) {
        matches = matches && voice.labels.gender.toLowerCase() === filters.gender.toLowerCase();
      }

      if (filters.age && voice.labels.age) {
        matches = matches && voice.labels.age.toLowerCase() === filters.age.toLowerCase();
      }

      if (filters.accent && voice.labels.accent) {
        matches = matches && voice.labels.accent.toLowerCase().includes(filters.accent.toLowerCase());
      }

      if (filters.use_case && voice.labels.use_case) {
        matches = matches && voice.labels.use_case.toLowerCase().includes(filters.use_case.toLowerCase());
      }

      return matches;
    });
  }
}

export default ElevenLabsTTSProvider;
