/**
 * Video Generation HTTP Service
 * Multi-provider async video generation with job tracking
 *
 * Providers: OpenAI Sora, Runway Gen-4, Google Veo, Pika (Fal.ai), Kling (Kie.ai)
 *
 * Endpoints:
 *   POST /generate         - Submit video generation job
 *   GET  /status/:job_id   - Check job status
 *   GET  /jobs             - List all jobs
 *   GET  /health           - Health check
 *   GET  /schema           - API schema
 */

import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

// Import providers
import { OpenAISoraProvider } from './providers/openai-sora.js';
import { RunwayProvider } from './providers/runway.js';
import { GoogleVeoProvider } from './providers/google-veo.js';
import { PikaFalProvider } from './providers/pika-fal.js';
import { KlingKieProvider } from './providers/kling-kie.js';

// Import utilities
import { jobTracker } from './utils/job-tracker.js';
import { logUsage } from './utils/usage-logger.js';

// Load config
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

// Initialize Express
const app = express();
app.use(express.json());

// Initialize providers
const providers = {
  'sora': new OpenAISoraProvider(config.sora || {}),
  'sora-pro': new OpenAISoraProvider(config['sora-pro'] || {}),
  'runway': new RunwayProvider(config.runway || {}),
  'veo': new GoogleVeoProvider(config.veo || {}),
  'pika': new PikaFalProvider(config.pika || {}),
  'kling': new KlingKieProvider(config.kling || {})
};

const defaultProvider = config.provider || 'sora';

/**
 * Generate a unique job ID
 */
function generateJobId() {
  return `vid_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Get provider by name
 */
function getProvider(name) {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(providers).join(', ')}`);
  }
  return provider;
}

/**
 * Get the API key for a provider from request api_keys object
 * Maps provider names to their API key names
 */
function getApiKeyForProvider(providerName, apiKeys) {
  if (!apiKeys) return undefined;

  const keyMap = {
    'sora': 'openai',
    'sora-pro': 'openai',
    'runway': 'runway',
    'veo': 'google',
    'pika': 'fal',
    'kling': 'kie'
  };

  const keyName = keyMap[providerName];
  return keyName ? apiKeys[keyName] : undefined;
}

// ============================================================================
// POST /generate - Submit a video generation job
// ============================================================================
app.post('/generate', async (req, res) => {
  try {
    const {
      prompt,
      provider: providerName,
      image_url,
      model,
      duration,
      duration_seconds,
      resolution,
      aspect_ratio,
      negative_prompt,
      with_audio,
      seed,
      // Provider-specific options
      style,                    // Sora
      first_frame_image,        // Veo
      last_frame_image,         // Veo
      reference_images,         // Veo
      api_keys                  // Dynamic API keys (optional, falls back to ENV)
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const selectedProvider = providerName || defaultProvider;
    const provider = getProvider(selectedProvider);

    // Get API key for the selected provider (falls back to ENV in provider)
    const apiKey = getApiKeyForProvider(selectedProvider, api_keys);

    console.log(`\n   [Video] Generating with ${selectedProvider}: "${prompt.substring(0, 50)}..."`);

    // Submit job to provider
    const providerResult = await provider.createJob({
      prompt,
      image_url,
      model,
      duration: duration || duration_seconds,
      duration_seconds: duration_seconds || duration,
      resolution,
      aspect_ratio,
      negative_prompt,
      with_audio,
      seed,
      style,
      first_frame_image,
      last_frame_image,
      reference_images,
      apiKey  // Pass API key to provider (provider will fall back to ENV if not provided)
    });

    // Create our job entry
    const jobId = generateJobId();
    const job = jobTracker.create(jobId, providerResult.provider_job_id, selectedProvider, {
      prompt: prompt.substring(0, 200),
      model: providerResult.model || model,
      duration: duration || duration_seconds,
      resolution,
      aspect_ratio,
      operation_name: providerResult.operation_name  // For Veo
    });

    // Start background polling for this job (pass API key for status checks)
    pollJobStatus(jobId, provider, providerResult.operation_name, apiKey);

    console.log(`   [Video] Job created: ${jobId} -> ${providerResult.provider_job_id}`);

    res.json({
      success: true,
      job_id: jobId,
      provider: selectedProvider,
      provider_job_id: providerResult.provider_job_id,
      status: job.status,
      message: 'Video generation started. Poll /status/:job_id for updates.',
      status_url: `/status/${jobId}`
    });

  } catch (error) {
    console.error('   [Video] Generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET /status/:job_id - Check job status
// ============================================================================
app.get('/status/:job_id', async (req, res) => {
  try {
    const { job_id } = req.params;
    const job = jobTracker.get(job_id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // If job is still in progress, optionally poll provider for fresh status
    if (job.status === 'queued' || job.status === 'in_progress') {
      // Return cached status (background polling updates this)
      return res.json({
        job_id: job.id,
        status: job.status,
        progress: job.progress,
        provider: job.provider,
        created_at: job.created_at,
        updated_at: job.updated_at,
        poll_count: job.poll_count
      });
    }

    // Job completed or failed
    const response = {
      job_id: job.id,
      status: job.status,
      provider: job.provider,
      created_at: job.created_at,
      updated_at: job.updated_at
    };

    if (job.status === 'completed' && job.result) {
      response.video_url = job.result.video_url;
      response.duration_seconds = job.result.duration_seconds;
      response.resolution = job.result.resolution;
    }

    if (job.status === 'failed') {
      response.error = job.error;
    }

    res.json(response);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET /jobs - List all jobs
// ============================================================================
app.get('/jobs', (req, res) => {
  const { status, provider, limit } = req.query;

  const jobs = jobTracker.list({
    status,
    provider,
    limit: limit ? parseInt(limit) : 50
  });

  res.json({
    count: jobs.length,
    jobs: jobs.map(j => ({
      job_id: j.id,
      status: j.status,
      provider: j.provider,
      prompt: j.metadata?.prompt,
      created_at: j.created_at,
      updated_at: j.updated_at,
      video_url: j.result?.video_url
    }))
  });
});

// ============================================================================
// DELETE /jobs/:job_id - Delete a job
// ============================================================================
app.delete('/jobs/:job_id', (req, res) => {
  const { job_id } = req.params;
  const deleted = jobTracker.delete(job_id);

  if (deleted) {
    res.json({ success: true, message: 'Job deleted' });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ============================================================================
// GET /providers - List available providers
// ============================================================================
app.get('/providers', (req, res) => {
  const providerInfo = Object.entries(providers).map(([name, p]) => ({
    name,
    available: hasApiKey(name),
    config: config[name] || {}
  }));

  res.json({
    default: defaultProvider,
    providers: providerInfo
  });
});

function hasApiKey(providerName) {
  const provider = providers[providerName];
  if (provider && typeof provider.isConfigured === 'function') {
    return provider.isConfigured();
  }

  // Fallback for providers without isConfigured method
  switch (providerName) {
    case 'sora':
    case 'sora-pro':
      return !!process.env.OPENAI_API_KEY;
    case 'runway':
      return !!process.env.RUNWAYML_API_SECRET;
    case 'veo':
      return !!process.env.GOOGLE_API_KEY;
    case 'pika':
      return !!process.env.FAL_KEY;
    case 'kling':
      return !!process.env.KIE_API_KEY;
    default:
      return false;
  }
}

// ============================================================================
// GET /stats - Get job statistics
// ============================================================================
app.get('/stats', (req, res) => {
  res.json(jobTracker.stats());
});

// ============================================================================
// GET /health - Health check
// ============================================================================
app.get('/health', (req, res) => {
  const availableProviders = Object.keys(providers).filter(hasApiKey);

  res.json({
    status: 'ok',
    service: 'video-gen',
    version: '1.0.0',
    providers: {
      configured: Object.keys(providers),
      available: availableProviders
    },
    jobs: jobTracker.stats()
  });
});

// ============================================================================
// GET /schema - API schema
// ============================================================================
app.get('/schema', (req, res) => {
  res.json({
    name: 'video-gen',
    description: 'Multi-provider async video generation service',
    version: '1.0.0',
    endpoints: {
      'POST /generate': {
        description: 'Submit a video generation job',
        body: {
          prompt: { type: 'string', required: true, description: 'Text description of the video' },
          provider: { type: 'string', enum: Object.keys(providers), default: defaultProvider },
          image_url: { type: 'string', description: 'Image URL for image-to-video' },
          duration: { type: 'number', description: 'Video duration in seconds' },
          resolution: { type: 'string', enum: ['720p', '1080p'], default: '1080p' },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9' },
          with_audio: { type: 'boolean', default: true },
          api_keys: {
            type: 'object',
            description: 'Optional API keys. Falls back to server ENV if not provided.',
            properties: {
              openai: { type: 'string', description: 'For sora/sora-pro providers' },
              runway: { type: 'string', description: 'For runway provider' },
              google: { type: 'string', description: 'For veo provider' },
              fal: { type: 'string', description: 'For pika provider' },
              kie: { type: 'string', description: 'For kling provider' }
            }
          }
        },
        response: {
          job_id: 'string',
          status: 'string',
          status_url: 'string'
        }
      },
      'GET /status/:job_id': {
        description: 'Check job status',
        response: {
          job_id: 'string',
          status: { enum: ['queued', 'in_progress', 'completed', 'failed'] },
          video_url: 'string (when completed)',
          error: 'string (when failed)'
        }
      },
      'GET /jobs': {
        description: 'List all jobs',
        query: {
          status: 'string',
          provider: 'string',
          limit: 'number'
        }
      },
      'GET /providers': {
        description: 'List available providers'
      },
      'GET /stats': {
        description: 'Get job statistics'
      }
    },
    providers: {
      sora: { models: ['sora-2'], maxDuration: 25, audio: true },
      'sora-pro': { models: ['sora-2-pro'], maxDuration: 25, audio: true },
      runway: { models: ['gen4_turbo', 'gen4'], maxDuration: 10, audio: false },
      veo: { models: ['veo-3.1-generate-preview'], maxDuration: 8, audio: true },
      pika: { models: ['pika/v2.2'], maxDuration: 10, audio: false },
      kling: { models: ['kling-2.1'], maxDuration: 120, audio: true }
    }
  });
});

// ============================================================================
// Background polling for job status
// ============================================================================
async function pollJobStatus(jobId, provider, operationName = null, apiKey = null) {
  const pollInterval = config.poll_interval_ms || 5000;
  const maxAttempts = config.max_poll_attempts || 360;

  let attempts = 0;

  const poll = async () => {
    const job = jobTracker.get(jobId);
    if (!job) return; // Job was deleted

    if (job.status === 'completed' || job.status === 'failed') {
      return; // Already done
    }

    attempts++;
    jobTracker.incrementPoll(jobId);

    if (attempts > maxAttempts) {
      jobTracker.setFailed(jobId, 'Polling timeout exceeded');
      return;
    }

    try {
      // Pass API key to getStatus (provider will fall back to ENV if not provided)
      const status = await provider.getStatus(job.provider_job_id, operationName, apiKey);

      if (status.status === 'completed') {
        jobTracker.setCompleted(jobId, {
          video_url: status.video_url,
          duration_seconds: status.duration_seconds,
          resolution: status.resolution
        });

        // Log usage
        await logUsage({
          provider: job.provider,
          job_id: jobId,
          duration_seconds: status.duration_seconds,
          model: job.metadata?.model,
          estimated_cost: provider.estimateCost?.(
            status.duration_seconds || job.metadata?.duration || 10,
            job.metadata?.model
          )
        });

        console.log(`   [Video] Job completed: ${jobId} -> ${status.video_url?.substring(0, 60)}...`);
        return;
      }

      if (status.status === 'failed') {
        jobTracker.setFailed(jobId, status.error);
        console.log(`   [Video] Job failed: ${jobId} - ${status.error}`);
        return;
      }

      // Still in progress
      jobTracker.setInProgress(jobId, status.progress);

      // Schedule next poll
      setTimeout(poll, pollInterval);

    } catch (error) {
      console.error(`   [Video] Poll error for ${jobId}:`, error.message);
      // Continue polling unless we've exceeded max attempts
      if (attempts < maxAttempts) {
        setTimeout(poll, pollInterval);
      } else {
        jobTracker.setFailed(jobId, `Polling failed: ${error.message}`);
      }
    }
  };

  // Start polling after initial delay
  setTimeout(poll, pollInterval);
}

// ============================================================================
// Start server
// ============================================================================
const PORT = process.env.VIDEO_GEN_HTTP_PORT || config.port || 3006;
app.listen(PORT, () => {
  const available = Object.keys(providers).filter(hasApiKey);

  console.log(`\n   Video Gen HTTP Service running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Schema: http://localhost:${PORT}/schema`);
  console.log(`\n   Available providers: ${available.length > 0 ? available.join(', ') : 'none (add API keys)'}`);
  console.log(`   Default provider: ${defaultProvider}`);
  console.log(`\n   This is a SHARED service - one instance serves all bots\n`);
});
