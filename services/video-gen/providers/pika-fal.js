/**
 * Pika Video Generation Provider via Fal.ai
 *
 * Models: fal-ai/pika/v2.2/text-to-video, fal-ai/pika/v2.2/image-to-video
 */

export class PikaFalProvider {
  constructor(config = {}) {
    this.apiKey = process.env.FAL_KEY;
    this.baseUrl = 'https://queue.fal.run';
    this.config = {
      model: config.model || 'fal-ai/pika/v2.2/text-to-video',
      resolution: config.resolution || '1080p',
      duration: config.duration || 5,
      aspect_ratio: config.aspect_ratio || '16:9',
      ...config
    };
  }

  get name() {
    return 'pika';
  }

  /**
   * Submit a video generation job
   */
  async createJob(options = {}) {
    const {
      prompt,
      image_url,        // For image-to-video
      model,
      resolution,
      duration,
      aspect_ratio,
      seed
    } = options;

    if (!prompt) {
      throw new Error('prompt is required');
    }

    // Choose model based on whether image is provided
    let modelPath = model || this.config.model;
    if (image_url && !model) {
      modelPath = 'fal-ai/pika/v2.2/image-to-video';
    }

    const requestBody = {
      prompt,
      resolution: resolution || this.config.resolution,
      duration: duration || this.config.duration,
      aspect_ratio: aspect_ratio || this.config.aspect_ratio
    };

    if (image_url) {
      requestBody.image_url = image_url;
    }
    if (seed !== undefined) {
      requestBody.seed = seed;
    }

    console.log(`   [Pika] Creating video job: "${prompt.substring(0, 50)}..."`);

    // Fal.ai queue endpoint for async processing
    const response = await fetch(`${this.baseUrl}/${modelPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Pika/Fal API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      provider_job_id: data.request_id,
      status: this.mapStatus(data.status),
      model: modelPath,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Check job status
   */
  async getStatus(providerJobId, model) {
    const modelPath = model || this.config.model;

    const response = await fetch(
      `${this.baseUrl}/${modelPath}/requests/${providerJobId}/status`,
      {
        headers: {
          'Authorization': `Key ${this.apiKey}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Pika status check failed: ${response.status}`);
    }

    const data = await response.json();

    const result = {
      provider_job_id: providerJobId,
      status: this.mapStatus(data.status),
      progress: 0
    };

    // If completed, fetch the result
    if (data.status === 'COMPLETED') {
      const resultResponse = await fetch(
        `${this.baseUrl}/${modelPath}/requests/${providerJobId}`,
        {
          headers: {
            'Authorization': `Key ${this.apiKey}`
          }
        }
      );

      if (resultResponse.ok) {
        const resultData = await resultResponse.json();
        result.video_url = resultData.video?.url || resultData.output?.video_url;
        result.duration_seconds = resultData.video?.duration;
      }
    }

    if (data.status === 'FAILED') {
      result.error = data.error || 'Video generation failed';
    }

    return result;
  }

  /**
   * Map Fal.ai status to our standard status
   */
  mapStatus(providerStatus) {
    const statusMap = {
      'IN_QUEUE': 'queued',
      'PENDING': 'queued',
      'IN_PROGRESS': 'in_progress',
      'PROCESSING': 'in_progress',
      'COMPLETED': 'completed',
      'FAILED': 'failed'
    };
    return statusMap[providerStatus?.toUpperCase()] || 'unknown';
  }

  /**
   * Estimate cost
   * 720p: $0.20 per 5s, 1080p: $0.45 per 5s
   */
  estimateCost(durationSeconds, resolution) {
    const res = resolution || this.config.resolution;
    const ratePerFiveSec = res === '1080p' ? 0.45 : 0.20;
    return (durationSeconds / 5) * ratePerFiveSec;
  }
}
