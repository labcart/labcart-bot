/**
 * Runway Gen-4 Video Generation Provider
 *
 * API: POST /v1/image_to_video
 * Base: https://api.dev.runwayml.com
 */

export class RunwayProvider {
  constructor(config = {}) {
    this.apiKey = process.env.RUNWAYML_API_SECRET;
    this.baseUrl = 'https://api.dev.runwayml.com/v1';
    this.apiVersion = config.api_version || '2024-11-06';
    this.config = {
      model: config.model || 'gen4_turbo',
      duration: config.duration || 5,
      ratio: config.ratio || '1280:720',
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
      throw new Error('No API key provided. Pass api_keys.runway in request or set RUNWAYML_API_SECRET environment variable.');
    }
    return key;
  }

  get name() {
    return 'runway';
  }

  /**
   * Submit a video generation job
   * @param {Object} options - Job options
   * @param {string} [options.apiKey] - Optional API key (falls back to ENV)
   */
  async createJob(options = {}) {
    const {
      prompt,
      image_url,      // Required for image-to-video
      model,
      duration,
      ratio,
      apiKey
    } = options;

    if (!prompt) {
      throw new Error('prompt is required');
    }

    const key = this.getApiKey(apiKey);

    const requestBody = {
      model: model || this.config.model,
      promptText: prompt,
      duration: duration || this.config.duration,
      ratio: ratio || this.config.ratio
    };

    // Image-to-video requires an image
    if (image_url) {
      requestBody.promptImage = image_url;
    }

    console.log(`   [Runway] Creating video job: "${prompt.substring(0, 50)}..."`);

    const response = await fetch(`${this.baseUrl}/image_to_video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'X-Runway-Version': this.apiVersion
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Runway API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      provider_job_id: data.id || data.task_id,
      status: this.mapStatus(data.status),
      model: requestBody.model,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Check job status
   * @param {string} providerJobId - Provider job ID
   * @param {string} [operationName] - Operation name (unused for Runway)
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async getStatus(providerJobId, operationName, apiKey) {
    const key = this.getApiKey(apiKey);

    const response = await fetch(`${this.baseUrl}/tasks/${providerJobId}`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'X-Runway-Version': this.apiVersion
      }
    });

    if (!response.ok) {
      throw new Error(`Runway status check failed: ${response.status}`);
    }

    const data = await response.json();

    const result = {
      provider_job_id: providerJobId,
      status: this.mapStatus(data.status),
      progress: data.progress || 0
    };

    if (data.status === 'SUCCEEDED' || data.status === 'completed') {
      result.video_url = data.output?.[0] || data.artifacts?.[0]?.url;
      result.duration_seconds = data.duration;
    }

    if (data.status === 'FAILED') {
      result.error = data.failure || data.error || 'Video generation failed';
    }

    return result;
  }

  /**
   * Map provider status to our standard status
   */
  mapStatus(providerStatus) {
    const statusMap = {
      'PENDING': 'queued',
      'QUEUED': 'queued',
      'RUNNING': 'in_progress',
      'IN_PROGRESS': 'in_progress',
      'SUCCEEDED': 'completed',
      'COMPLETED': 'completed',
      'FAILED': 'failed',
      'CANCELLED': 'failed'
    };
    return statusMap[providerStatus?.toUpperCase()] || 'unknown';
  }

  /**
   * Estimate cost (1 credit = $0.01)
   * Gen-4 Turbo: ~2.4 credits/sec, Gen-4: ~6 credits/sec
   */
  estimateCost(durationSeconds, model) {
    const rates = {
      'gen4_turbo': 0.024,
      'gen4': 0.06,
      'gen4_image': 0.08  // per image
    };
    const rate = rates[model] || rates['gen4_turbo'];
    return durationSeconds * rate;
  }
}
