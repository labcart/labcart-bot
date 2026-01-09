/**
 * Kling Video Generation Provider via Kie.ai
 *
 * Kie.ai provides API access to Kling models since Kuaishou
 * doesn't have an official public API
 */

export class KlingKieProvider {
  constructor(config = {}) {
    this.apiKey = process.env.KIE_API_KEY;
    this.baseUrl = 'https://api.kie.ai/v1';
    this.config = {
      model: config.model || 'kling-2.1',
      duration: config.duration || 5,
      with_audio: config.with_audio || false,
      ...config
    };
  }

  get name() {
    return 'kling';
  }

  /**
   * Submit a video generation job
   */
  async createJob(options = {}) {
    const {
      prompt,
      image_url,
      model,
      duration,
      with_audio,
      aspect_ratio
    } = options;

    if (!prompt) {
      throw new Error('prompt is required');
    }

    const requestBody = {
      model: model || this.config.model,
      prompt,
      duration: duration || this.config.duration,
      sound: with_audio ?? this.config.with_audio
    };

    if (image_url) {
      requestBody.image_url = image_url;
    }
    if (aspect_ratio) {
      requestBody.aspect_ratio = aspect_ratio;
    }

    console.log(`   [Kling] Creating video job: "${prompt.substring(0, 50)}..."`);

    const response = await fetch(`${this.baseUrl}/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kling/Kie API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      provider_job_id: data.task_id || data.id,
      status: this.mapStatus(data.status),
      model: requestBody.model,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Check job status
   */
  async getStatus(providerJobId) {
    const response = await fetch(
      `${this.baseUrl}/video/status/${providerJobId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Kling status check failed: ${response.status}`);
    }

    const data = await response.json();

    const result = {
      provider_job_id: providerJobId,
      status: this.mapStatus(data.status),
      progress: data.progress || 0
    };

    if (data.status === 'completed' || data.status === 'success') {
      result.video_url = data.video_url || data.result?.url;
      result.duration_seconds = data.duration;
    }

    if (data.status === 'failed' || data.status === 'error') {
      result.error = data.error || data.message || 'Video generation failed';
    }

    return result;
  }

  /**
   * Map status
   */
  mapStatus(providerStatus) {
    const statusMap = {
      'pending': 'queued',
      'queued': 'queued',
      'processing': 'in_progress',
      'in_progress': 'in_progress',
      'completed': 'completed',
      'success': 'completed',
      'failed': 'failed',
      'error': 'failed'
    };
    return statusMap[providerStatus?.toLowerCase()] || 'unknown';
  }

  /**
   * Estimate cost
   * Kling via Kie.ai: ~$0.28 per 5s without audio, ~$0.55 with audio
   */
  estimateCost(durationSeconds, withAudio) {
    const ratePerFiveSec = withAudio ? 0.55 : 0.28;
    return (durationSeconds / 5) * ratePerFiveSec;
  }
}
