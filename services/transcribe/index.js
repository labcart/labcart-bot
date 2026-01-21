#!/usr/bin/env node

/**
 * Transcribe HTTP Service (Standalone)
 *
 * Audio/Video to Text transcription using OpenAI Whisper.
 * Runs once globally and serves all MCP Router instances.
 */

import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { OpenAIWhisperProvider } from './providers/openai-whisper.js';
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
  console.error('  Failed to load config.json:', error.message);
  process.exit(1);
}

// Initialize provider
const provider = new OpenAIWhisperProvider(config.openai || {});
const providerName = 'openai';

console.log(`   Transcribe HTTP Service starting with provider: ${providerName}`);

// Setup upload directory
const uploadDir = path.resolve(__dirname, config.upload_dir || './uploads');
await fs.mkdir(uploadDir, { recursive: true });

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `upload-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: (config.max_file_size_mb || 25) * 1024 * 1024, // Default 25MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'ogg', 'flac'];
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const mimeOk = file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/');

    if (allowedTypes.includes(ext) || mimeOk) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Supported: ${allowedTypes.join(', ')}`));
    }
  }
});

// Create Express app
const app = express();
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    provider: providerName,
    queue: {
      length: requestQueue.length,
      processing: requestQueue.processing,
      maxSize: requestQueue.maxQueueSize
    },
    supported_formats: provider.getSupportedFormats()
  });
});

// Get tool schema
app.get('/schema', (req, res) => {
  res.json([
    {
      name: 'transcribe',
      description: 'Transcribe audio or video file to text using OpenAI Whisper. Supports mp3, mp4, m4a, wav, webm, and more. Returns the transcribed text. Can auto-detect language or use a specified language code.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the audio/video file to transcribe (local path or URL)',
          },
          language: {
            type: 'string',
            description: 'Language code (e.g., "en", "es", "fr"). Auto-detected if not provided.',
          },
          prompt: {
            type: 'string',
            description: 'Optional prompt to guide transcription style or provide context',
          },
          response_format: {
            type: 'string',
            enum: ['json', 'text', 'srt', 'vtt', 'verbose_json'],
            description: 'Output format. Use "srt" or "vtt" for subtitles, "verbose_json" for timestamps.',
          },
          timestamps: {
            type: 'boolean',
            description: 'Include word-level timestamps (forces verbose_json format)',
          },
          api_keys: {
            type: 'object',
            description: 'Optional API keys. Falls back to server ENV if not provided.',
            properties: {
              openai: { type: 'string', description: 'OpenAI API key (sk-...)' }
            }
          }
        },
        required: ['file_path'],
      },
    },
    {
      name: 'translate',
      description: 'Translate audio from any language to English text. Uses OpenAI Whisper.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the audio/video file to translate',
          },
          prompt: {
            type: 'string',
            description: 'Optional prompt to guide translation style',
          },
          response_format: {
            type: 'string',
            enum: ['json', 'text', 'srt', 'vtt'],
            description: 'Output format',
          },
          api_keys: {
            type: 'object',
            description: 'Optional API keys. Falls back to server ENV if not provided.',
            properties: {
              openai: { type: 'string', description: 'OpenAI API key (sk-...)' }
            }
          }
        },
        required: ['file_path'],
      },
    },
  ]);
});

/**
 * Clean up uploaded file after processing
 */
async function cleanupFile(filePath) {
  try {
    if (filePath && fsSync.existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  } catch (err) {
    console.warn(`   Failed to cleanup file: ${err.message}`);
  }
}

/**
 * Download file from URL to local path (streams to disk for large files)
 */
async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  // Get content length for progress logging
  const contentLength = response.headers.get('content-length');
  const totalMB = contentLength ? (parseInt(contentLength) / 1024 / 1024).toFixed(2) : 'unknown';
  console.log(`   Downloading ${totalMB}MB...`);

  // Stream to file instead of buffering in memory
  const fileStream = fsSync.createWriteStream(destPath);

  const reader = response.body.getReader();
  let downloaded = 0;
  let lastLog = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    fileStream.write(value);
    downloaded += value.length;

    // Log progress every 50MB
    const downloadedMB = downloaded / 1024 / 1024;
    if (downloadedMB - lastLog > 50) {
      console.log(`   Downloaded ${downloadedMB.toFixed(0)}MB...`);
      lastLog = downloadedMB;
    }
  }

  fileStream.end();

  // Wait for file to finish writing
  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  const stats = fsSync.statSync(destPath);
  console.log(`   Download complete: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

  return destPath;
}

/**
 * Extract audio from video file using ffmpeg
 * Converts to MP3 at 64kbps mono (small file size, good for speech)
 */
async function extractAudio(inputPath, outputPath) {
  console.log(`   Extracting audio from video...`);

  // -vn: no video, -ac 1: mono, -ar 16000: 16kHz (good for speech), -b:a 64k: 64kbps
  const cmd = `ffmpeg -i "${inputPath}" -vn -ac 1 -ar 16000 -b:a 64k -y "${outputPath}"`;

  try {
    await execAsync(cmd, { timeout: 600000 }); // 10 min timeout
    const stats = fsSync.statSync(outputPath);
    console.log(`   Audio extracted: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
    return outputPath;
  } catch (error) {
    throw new Error(`Failed to extract audio: ${error.message}`);
  }
}

/**
 * Get audio duration in seconds using ffprobe
 */
async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Split audio file into chunks of specified duration
 */
async function splitAudioIntoChunks(inputPath, chunkDurationSecs = 600) {
  const duration = await getAudioDuration(inputPath);
  if (!duration) {
    throw new Error('Could not determine audio duration');
  }

  const numChunks = Math.ceil(duration / chunkDurationSecs);
  console.log(`   Splitting ${duration.toFixed(0)}s audio into ${numChunks} chunks...`);

  const chunks = [];
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const dir = path.dirname(inputPath);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDurationSecs;
    const chunkPath = path.join(dir, `${baseName}-chunk${i}.mp3`);

    const cmd = `ffmpeg -i "${inputPath}" -ss ${startTime} -t ${chunkDurationSecs} -c copy -y "${chunkPath}"`;
    await execAsync(cmd, { timeout: 120000 });

    // Verify chunk exists and has content
    if (fsSync.existsSync(chunkPath)) {
      const stats = fsSync.statSync(chunkPath);
      if (stats.size > 1000) { // More than 1KB
        chunks.push(chunkPath);
      }
    }
  }

  console.log(`   Created ${chunks.length} audio chunks`);
  return chunks;
}

/**
 * Process large file: extract audio, split if needed, transcribe all parts
 * @param {string} filePath - Path to the file
 * @param {Object} provider - The transcription provider
 * @param {Object} options - Transcription options
 * @param {string} [apiKey] - Optional API key
 */
async function processLargeFile(filePath, provider, options = {}, apiKey = null) {
  const filesToCleanup = [];

  try {
    const stats = fsSync.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    const ext = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.mpeg', '.webm', '.mov', '.avi', '.mkv'].includes(ext);

    let audioPath = filePath;

    // Extract audio if it's a video file
    if (isVideo) {
      const audioOutputPath = filePath.replace(ext, '-audio.mp3');
      audioPath = await extractAudio(filePath, audioOutputPath);
      filesToCleanup.push(audioPath);
    }

    // Check audio file size
    const audioStats = fsSync.statSync(audioPath);
    const audioSizeMB = audioStats.size / (1024 * 1024);

    // If under 25MB, transcribe directly
    if (audioSizeMB <= 24) {
      console.log(`   Audio is ${audioSizeMB.toFixed(2)}MB - transcribing directly`);
      return await provider.transcribe({ file_path: audioPath, ...options, apiKey });
    }

    // Split into ~10 minute chunks (should be under 25MB each at 64kbps)
    const chunks = await splitAudioIntoChunks(audioPath, 600);
    filesToCleanup.push(...chunks);

    // Transcribe each chunk
    const transcriptions = [];
    let totalDuration = 0;

    for (let i = 0; i < chunks.length; i++) {
      console.log(`   Transcribing chunk ${i + 1}/${chunks.length}...`);
      const result = await provider.transcribe({ file_path: chunks[i], ...options, apiKey });
      transcriptions.push(result.text);
      if (result.duration_seconds) {
        totalDuration += result.duration_seconds;
      }
    }

    // Combine all transcriptions
    const combinedText = transcriptions.join('\n\n');

    return {
      success: true,
      text: combinedText,
      duration_seconds: totalDuration || null,
      chunks_processed: chunks.length,
      provider: 'openai',
      model_used: 'whisper-1',
      file_size_mb: fileSizeMB,
      audio_size_mb: audioSizeMB,
      was_chunked: true
    };

  } finally {
    // Cleanup temporary files
    for (const file of filesToCleanup) {
      try {
        if (fsSync.existsSync(file)) {
          await fs.unlink(file);
        }
      } catch (e) {
        console.warn(`   Failed to cleanup: ${file}`);
      }
    }
  }
}

// POST /transcribe - Transcribe audio/video to text
app.post('/transcribe', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  let filePath = null;
  let shouldCleanup = false;

  try {
    // Get file path from upload or request body
    if (req.file) {
      filePath = req.file.path;
      shouldCleanup = true;
    } else if (req.body.file_path) {
      // Check if it's a URL
      if (req.body.file_path.startsWith('http://') || req.body.file_path.startsWith('https://')) {
        const ext = path.extname(new URL(req.body.file_path).pathname) || '.mp3';
        const tempPath = path.join(uploadDir, `download-${Date.now()}${ext}`);
        console.log(`   Downloading from URL: ${req.body.file_path}`);
        filePath = await downloadFile(req.body.file_path, tempPath);
        shouldCleanup = true;
      } else {
        filePath = req.body.file_path;
        shouldCleanup = false; // Don't delete user's file
      }
    } else {
      return res.status(400).json({ error: 'No file provided. Upload a file or provide file_path.' });
    }

    const { language, prompt, response_format, timestamps, api_keys } = req.body;

    console.log(`   [HTTP] Transcribing: ${path.basename(filePath)}`);

    // Check file size
    const stats = fsSync.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    let result;

    if (fileSizeMB > 24) {
      // Large file - needs extraction/chunking
      console.log(`   Large file detected (${fileSizeMB.toFixed(2)}MB) - processing...`);
      result = await requestQueue.add(async () => {
        return await processLargeFile(filePath, provider, {
          language,
          prompt,
          response_format,
          timestamps: timestamps === true || timestamps === 'true'
        }, api_keys?.openai);
      });
    } else {
      // Small file - transcribe directly
      result = await requestQueue.add(async () => {
        return await provider.transcribe({
          file_path: filePath,
          language,
          prompt,
          response_format,
          timestamps: timestamps === true || timestamps === 'true',
          apiKey: api_keys?.openai
        });
      });
    }

    const durationMs = Date.now() - startTime;

    console.log(`  [HTTP] Transcription complete: ${result.text?.substring(0, 50)}... (${durationMs}ms)`);

    // Log usage
    await logUsage({
      tool: 'transcribe',
      provider: result.provider,
      durationSeconds: result.duration_seconds,
      fileSizeMb: result.file_size_mb,
      language: result.language,
      durationMs,
      success: true,
    });

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`  [HTTP] Transcription error after ${durationMs}ms:`, error.message);

    await logUsage({
      tool: 'transcribe',
      provider: providerName,
      durationMs,
      success: false,
      error: error.message,
    });

    res.status(500).json({ error: error.message });
  } finally {
    if (shouldCleanup) {
      await cleanupFile(filePath);
    }
  }
});

// POST /translate - Translate audio to English
app.post('/translate', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  let filePath = null;
  let shouldCleanup = false;

  try {
    if (req.file) {
      filePath = req.file.path;
      shouldCleanup = true;
    } else if (req.body.file_path) {
      if (req.body.file_path.startsWith('http://') || req.body.file_path.startsWith('https://')) {
        const ext = path.extname(new URL(req.body.file_path).pathname) || '.mp3';
        const tempPath = path.join(uploadDir, `download-${Date.now()}${ext}`);
        filePath = await downloadFile(req.body.file_path, tempPath);
        shouldCleanup = true;
      } else {
        filePath = req.body.file_path;
      }
    } else {
      return res.status(400).json({ error: 'No file provided. Upload a file or provide file_path.' });
    }

    const { prompt, response_format, api_keys } = req.body;

    console.log(`   [HTTP] Translating to English: ${path.basename(filePath)}`);

    const result = await requestQueue.add(async () => {
      return await provider.translate({
        file_path: filePath,
        prompt,
        response_format,
        apiKey: api_keys?.openai
      });
    });

    const durationMs = Date.now() - startTime;

    console.log(`  [HTTP] Translation complete (${durationMs}ms)`);

    await logUsage({
      tool: 'translate',
      provider: result.provider,
      fileSizeMb: result.file_size_mb,
      language: 'to-english',
      durationMs,
      success: true,
    });

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`  [HTTP] Translation error:`, error.message);

    await logUsage({
      tool: 'translate',
      provider: providerName,
      durationMs,
      success: false,
      error: error.message,
    });

    res.status(500).json({ error: error.message });
  } finally {
    if (shouldCleanup) {
      await cleanupFile(filePath);
    }
  }
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `File too large. Maximum size: ${config.max_file_size_mb || 25}MB` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Start server
const PORT = process.env.TRANSCRIBE_HTTP_PORT || config.port || 3005;
app.listen(PORT, () => {
  console.log(`\n   Transcribe HTTP Service running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Schema: http://localhost:${PORT}/schema`);
  console.log(`\n   This is a SHARED service - one instance serves all bots\n`);
});
