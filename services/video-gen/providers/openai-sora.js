/**
 * OpenAI Sora Video Generation Provider
 * Supports Sora 2 and Sora 2 Pro models
 *
 * API: POST /videos, GET /videos/{id}, GET /videos/{id}/content
 */

export class OpenAISoraProvider {
  constructor(config = {}) {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.baseUrl = 'https://api.openai.com/v1';
    this.config = {
      model: config.model || 'sora-2',
      duration_seconds: config.duration_seconds || 10,
      resolution: config.resolution || '1080p',
      aspect_ratio: config.aspect_ratio || '16:9',
      with_audio: config.with_audio !== false,
      ...config
    };
  }

  /**
   * Check if provider is configured (has default API key)
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get the API key to use (request key or instance key)
   * @param {string} [apiKey] - Optional API key from request
   * @returns {string} The API key to use
   */
  getApiKey(apiKey) {
    const key = apiKey || this.apiKey;
    if (!key) {
      throw new Error('No API key provided. Pass api_keys.openai in request or set OPENAI_API_KEY environment variable.');
    }
    return key;
  }

  /**
   * Make authenticated request to OpenAI API
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async request(method, endpoint, body = null, apiKey) {
    const key = this.getApiKey(apiKey);

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  get name() {
    return 'openai-sora';
  }

  /**
   * Submit a video generation job
   * Returns job info with provider_job_id for polling
   * @param {Object} options - Job options
   * @param {string} [options.apiKey] - Optional API key (falls back to ENV)
   */
  async createJob(options = {}) {
    const {
      prompt,
      image_url,        // Optional: for image-to-video
      model,
      duration_seconds,
      resolution,
      aspect_ratio,
      style,
      with_audio,
      apiKey
    } = options;

    if (!prompt) {
      throw new Error('prompt is required');
    }

    const requestBody = {
      model: model || this.config.model,
      input: {
        prompt
      }
    };

    // Image-to-video mode
    if (image_url) {
      requestBody.input.image_url = image_url;
    }

    // Optional parameters
    if (duration_seconds || this.config.duration_seconds) {
      requestBody.duration_seconds = duration_seconds || this.config.duration_seconds;
    }
    if (resolution || this.config.resolution) {
      requestBody.resolution = resolution || this.config.resolution;
    }
    if (aspect_ratio || this.config.aspect_ratio) {
      requestBody.aspect_ratio = aspect_ratio || this.config.aspect_ratio;
    }
    if (style) {
      requestBody.style = style;
    }
    if (with_audio !== undefined || this.config.with_audio !== undefined) {
      requestBody.with_audio = with_audio ?? this.config.with_audio;
    }

    console.log(`   [Sora] Creating video job: "${prompt.substring(0, 50)}..."`);

    const response = await this.request('POST', '/videos', requestBody, apiKey);

    return {
      provider_job_id: response.id,
      status: this.mapStatus(response.status),
      model: requestBody.model,
      created_at: response.created_at
    };
  }

  /**
   * Check job status
   * @param {string} providerJobId - Provider job ID
   * @param {string} [operationName] - Operation name (unused for Sora)
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async getStatus(providerJobId, operationName, apiKey) {
    const response = await this.request('GET', `/videos/${providerJobId}`, null, apiKey);

    const result = {
      provider_job_id: providerJobId,
      status: this.mapStatus(response.status),
      progress: response.progress || 0
    };

    if (response.status === 'completed') {
      result.video_url = response.output_url || response.video?.url;
      result.duration_seconds = response.duration_seconds;
      result.resolution = response.resolution;
    }

    if (response.status === 'failed') {
      result.error = response.error?.message || 'Video generation failed';
    }

    return result;
  }

  /**
   * Download the completed video content
   * @param {string} providerJobId - Provider job ID
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async getContent(providerJobId, apiKey) {
    const response = await this.request('GET', `/videos/${providerJobId}/content`, null, apiKey);
    return {
      video_url: response.url,
      content_type: response.content_type || 'video/mp4'
    };
  }

  /**
   * Map provider status to our standard status
   */
  mapStatus(providerStatus) {
    const statusMap = {
      'queued': 'queued',
      'in_progress': 'in_progress',
      'processing': 'in_progress',
      'completed': 'completed',
      'succeeded': 'completed',
      'failed': 'failed',
      'error': 'failed',
      'cancelled': 'failed'
    };
    return statusMap[providerStatus] || 'unknown';
  }

  /**
   * Estimate cost based on duration and model
   */
  estimateCost(durationSeconds, model) {
    // Sora 2: ~$0.10-0.20/sec, Sora 2 Pro: ~$0.30-0.50/sec
    const rates = {
      'sora-2': 0.15,
      'sora-2-pro': 0.40
    };
    const rate = rates[model] || rates['sora-2'];
    return durationSeconds * rate;
  }
}
