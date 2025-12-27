#!/usr/bin/env node

/**
 * TTS HTTP Service (Standalone)
 *
 * Self-contained HTTP server that provides TTS functionality.
 * Runs once globally and serves all MCP Router instances.
 *
 * No MCP dependencies - just Express + TTS providers
 */

import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Upload a file to R2 storage via HTTP endpoint
 * @param {string} localPath - Path to the local file
 * @param {object} r2Config - R2 configuration { upload_url, user_id, workflow_id }
 * @returns {Promise<{r2_url: string, r2_key: string} | null>} R2 result or null on failure
 */
async function uploadToR2(localPath, r2Config) {
  if (!r2Config || !r2Config.upload_url) {
    return null;
  }

  try {
    const fileContent = fsSync.readFileSync(localPath);
    const filename = path.basename(localPath);
    const ext = path.extname(localPath).slice(1);

    // Determine content type
    const contentTypes = {
      'mp3': 'audio/mpeg',
      'ogg': 'audio/ogg',
      'wav': 'audio/wav',
      'webm': 'audio/webm'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Build R2 path
    const r2Path = r2Config.workflow_id && r2Config.workflow_id !== 'general'
      ? `users/${r2Config.user_id}/workflows/${r2Config.workflow_id}`
      : `users/${r2Config.user_id}/files`;

    const uploadUrl = `${r2Config.upload_url}?workflowId=${encodeURIComponent(r2Path)}&filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(contentType)}`;

    console.log(`   ☁️  Uploading to R2: ${filename}`);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: fileContent
    });

    if (response.ok) {
      const result = await response.json();
      // Delete local file after successful upload
      fsSync.unlinkSync(localPath);
      console.log(`   ✓ Uploaded to R2: ${result.key}`);
      return { r2_url: result.signedUrl, r2_key: result.key };
    } else {
      console.warn(`   ⚠️  R2 upload failed: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.warn(`   ⚠️  R2 upload error: ${error.message}`);
    return null;
  }
}

// Import providers from local directory
import { GoogleTTSProvider } from './providers/google-tts.js';
import { OpenAITTSProvider } from './providers/openai-tts.js';
import { ElevenLabsTTSProvider } from './providers/elevenlabs-tts.js';
import { requestQueue } from './utils/request-queue.js';
import { logUsage } from './utils/usage-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Load configuration
let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = await fs.readFile(configPath, 'utf-8');
  config = JSON.parse(configData);
} catch (error) {
  console.error('❌ Failed to load config.json:', error.message);
  process.exit(1);
}

// Initialize providers
const providers = {};
const defaultProvider = config.provider || 'openai';

if (config.google) {
  providers.google = new GoogleTTSProvider(config.google);
  providers.google.config.output_dir = config.output_dir;
}

if (config.openai) {
  providers.openai = new OpenAITTSProvider(config.openai);
  providers.openai.config.output_dir = config.output_dir;
}

if (config.elevenlabs) {
  providers.elevenlabs = new ElevenLabsTTSProvider(config.elevenlabs);
  providers.elevenlabs.config.output_dir = config.output_dir;
}

const providerNames = Object.keys(providers);
console.log(`🎙️  TTS HTTP Service starting with providers: ${providerNames.join(', ')}`);
console.log(`📌 Default provider: ${defaultProvider}`);

/**
 * Post-process audio: normalize levels and convert to OGG/OPUS for Telegram
 *
 * @param {string} inputPath - Path to the input MP3 file
 * @returns {Promise<{path: string, format: string}>} Path to the processed OGG file
 */
async function postProcessAudio(inputPath) {
  const outputPath = inputPath.replace(/\.mp3$/, '.ogg');

  try {
    // ffmpeg command:
    // -i input.mp3 : input file
    // -af loudnorm : normalize audio levels (EBU R128 standard)
    // -c:a libopus : encode with Opus codec
    // -b:a 48k : 48kbps bitrate (good quality for voice, small file)
    // -vbr on : variable bitrate for better quality
    // -application voip : optimize for voice
    // -y : overwrite output if exists
    const cmd = `ffmpeg -i "${inputPath}" -af loudnorm -c:a libopus -b:a 48k -vbr on -application voip -y "${outputPath}"`;

    await execAsync(cmd);

    // Remove the original MP3 to save space
    await fs.unlink(inputPath);

    console.log(`🔊 [HTTP] Audio post-processed: MP3 → OGG/OPUS with loudnorm`);

    return { path: outputPath, format: 'ogg' };
  } catch (error) {
    console.warn(`⚠️  [HTTP] ffmpeg post-processing failed, using original MP3: ${error.message}`);
    // Fall back to original MP3 if ffmpeg fails
    return { path: inputPath, format: 'mp3' };
  }
}

// Create Express app
const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check with queue status
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    providers: providerNames,
    defaultProvider,
    queue: {
      length: requestQueue.length,
      processing: requestQueue.processing,
      maxSize: requestQueue.maxQueueSize
    }
  });
});

// Get tool schema (for MCP Router to register)
app.get('/schema', (req, res) => {
  res.json([
    {
      name: 'text_to_speech',
      description: `Convert text to speech audio using multiple TTS providers (${providerNames.join(', ')}). Returns an audio file path and base64-encoded audio data. Perfect for generating voice messages, audio responses, or accessibility features.`,
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to convert to speech. Can be up to several paragraphs long.',
          },
          provider: {
            type: 'string',
            description: `TTS provider to use: ${providerNames.join(', ')} (default: ${defaultProvider})`,
            enum: providerNames,
          },
          voice: {
            type: 'string',
            description: 'Voice to use. For OpenAI: alloy, echo, fable, onyx, nova, shimmer. For ElevenLabs: voice ID like EXAVITQu4vr4xnSDxMaL (Bella). For Google: en-US-Neural2-F, en-US-Neural2-J, etc.',
          },
          speed: {
            type: 'number',
            description: 'Speaking rate/speed multiplier (0.25-4.0, default: 1.0)',
          },
          include_base64: {
            type: 'boolean',
            description: 'Include base64-encoded audio in response (default: false). Set to true only if needed, as it significantly increases response size.',
          },
          filename: {
            type: 'string',
            description: 'Custom filename prefix (optional). Timestamp will be automatically appended. Example: "welcome" becomes "welcome-1234567890.mp3"',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'list_tts_voices',
      description: `List available TTS voices for a specific provider`,
      inputSchema: {
        type: 'object',
        properties: {
          provider: {
            type: 'string',
            description: `TTS provider to list voices for: ${providerNames.join(', ')} (default: ${defaultProvider})`,
            enum: providerNames,
          },
          language_code: {
            type: 'string',
            description: 'Language code filter (e.g., en-US). Only used for Google provider.',
          },
        },
      },
    },
  ]);
});

// Execute text_to_speech tool
app.post('/text_to_speech', async (req, res) => {
  const startTime = Date.now();  // Define before try so catch can access it
  try {
    const { text, provider, voice, speed, include_base64 = false, filename, output_dir, r2_config } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text parameter is required' });
    }

    // Select provider
    const selectedProvider = provider || defaultProvider;
    const ttsProvider = providers[selectedProvider];

    if (!ttsProvider) {
      return res.status(400).json({
        error: `Provider "${selectedProvider}" not available. Available providers: ${providerNames.join(', ')}`
      });
    }

    // Guard rail: prevent excessive input
    if (text.length > 4096) {
      return res.status(400).json({
        error: `Text too long (${text.length} characters). Maximum: 4096 characters.`
      });
    }

    console.log(`🎤 [HTTP] Generating speech with ${selectedProvider}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

    // Override output directory if provided in request (allows multi-bot usage)
    if (output_dir) {
      console.log(`📂 [HTTP] Using custom output directory: ${output_dir}`);
      ttsProvider.config.output_dir = output_dir;
    }

    // Use queue to prevent concurrent API calls
    // Add timeout wrapper to prevent requests from hanging indefinitely
    const overallTimeout = 60000; // 60 seconds max for entire request
    const requestPromise = requestQueue.add(async () => {
      return await ttsProvider.generateSpeech({
        text,
        voice,
        speed,
        filename,
      });
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TTS request timeout after ${overallTimeout}ms`)), overallTimeout)
    );

    const result = await Promise.race([requestPromise, timeoutPromise]);

    // Post-process audio: normalize levels and convert to OGG/OPUS
    const processed = await postProcessAudio(result.audio_path);
    result.audio_path = processed.path;
    result.format = processed.format;

    const durationMs = Date.now() - startTime;

    // Log with performance warnings
    if (durationMs > 15000) {
      console.warn(`⚠️  [HTTP] SLOW: Audio generation took ${durationMs}ms`);
    } else if (durationMs > 5000) {
      console.log(`✅ [HTTP] Audio generated: ${result.audio_path} (${durationMs}ms - slower than usual)`);
    } else {
      console.log(`✅ [HTTP] Audio generated: ${result.audio_path} (${durationMs}ms)`);
    }

    // Log usage
    await logUsage({
      tool: 'text_to_speech',
      provider: result.provider,
      characterCount: result.character_count,
      voice: result.voice_used,
      filename: filename,
      durationMs: durationMs,
      success: true,
    });

    // Build response
    const response = {
      success: result.success,
      format: result.format,
      character_count: result.character_count,
      provider: result.provider,
      voice_used: result.voice_used,
      file_size_bytes: result.file_size_bytes,
    };

    // Upload to R2 if config provided, otherwise return local path
    const r2Result = await uploadToR2(result.audio_path, r2_config);
    if (r2Result) {
      response.r2_url = r2Result.r2_url;
      response.r2_key = r2Result.r2_key;
    } else {
      response.audio_path = result.audio_path;
    }

    // Only include base64 if requested
    if (include_base64) {
      response.audio_base64 = result.audio_base64;
    }

    res.json(response);

  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Enhanced error logging with context
    if (error.message.includes('timeout')) {
      console.error(`❌ [HTTP] TTS TIMEOUT after ${durationMs}ms:`, error.message);
      console.error(`   Queue status: ${requestQueue.length} waiting, processing: ${requestQueue.processing}`);
    } else {
      console.error(`❌ [HTTP] TTS error after ${durationMs}ms:`, error.message);
    }

    res.status(500).json({ error: error.message });
  }
});

// Execute list_tts_voices tool
app.post('/list_tts_voices', async (req, res) => {
  try {
    const { provider, language_code } = req.body || {};

    // Select provider
    const selectedProvider = provider || defaultProvider;
    const ttsProvider = providers[selectedProvider];

    if (!ttsProvider) {
      return res.status(400).json({
        error: `Provider "${selectedProvider}" not available. Available providers: ${providerNames.join(', ')}`
      });
    }

    console.log(`📋 [HTTP] Listing available voices for ${selectedProvider}...`);

    const voices = selectedProvider === 'google'
      ? await ttsProvider.listVoices(language_code || 'en-US')
      : await ttsProvider.listVoices();

    res.json(voices);

  } catch (error) {
    console.error('❌ [HTTP] List voices error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.TTS_HTTP_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 TTS HTTP Service running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Schema: http://localhost:${PORT}/schema`);
  console.log(`\n📦 This is a SHARED service - one instance serves all bots\n`);
});
