/**
 * Google Veo Video Generation Provider
 * Uses Gemini API for Veo 3.1
 *
 * API: POST /models/{model}:predictLongRunning
 * Base: https://generativelanguage.googleapis.com/v1beta
 */

export class GoogleVeoProvider {
  constructor(config = {}) {
    this.apiKey = process.env.GOOGLE_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.config = {
      model: config.model || 'veo-3.1-generate-preview',
      duration_seconds: config.duration_seconds || '8',
      resolution: config.resolution || '1080p',
      aspect_ratio: config.aspect_ratio || '16:9',
      ...config
    };
  }

  get name() {
    return 'google-veo';
  }

  /**
   * Submit a video generation job (long-running operation)
   */
  async createJob(options = {}) {
    const {
      prompt,
      negative_prompt,
      image_url,           // For image-to-video
      first_frame_image,   // First frame
      last_frame_image,    // Last frame
      reference_images,    // Up to 3 reference images
      model,
      duration_seconds,
      resolution,
      aspect_ratio
    } = options;

    if (!prompt) {
      throw new Error('prompt is required');
    }

    const modelName = model || this.config.model;
    const requestBody = {
      instances: [{
        prompt
      }],
      parameters: {
        aspectRatio: aspect_ratio || this.config.aspect_ratio,
        durationSeconds: duration_seconds || this.config.duration_seconds,
        resolution: resolution || this.config.resolution,
        generateAudio: true
      }
    };

    // Add optional parameters
    if (negative_prompt) {
      requestBody.parameters.negativePrompt = negative_prompt;
    }

    // Image inputs
    if (image_url) {
      requestBody.instances[0].image = { uri: image_url };
    }
    if (first_frame_image) {
      requestBody.instances[0].firstFrame = { uri: first_frame_image };
    }
    if (last_frame_image) {
      requestBody.instances[0].lastFrame = { uri: last_frame_image };
    }
    if (reference_images && reference_images.length > 0) {
      requestBody.instances[0].referenceImages = reference_images.slice(0, 3).map(uri => ({ uri }));
    }

    console.log(`   [Veo] Creating video job: "${prompt.substring(0, 50)}..."`);

    const response = await fetch(
      `${this.baseUrl}/models/${modelName}:predictLongRunning?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Veo API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    // Veo returns an operation name like "operations/abc123"
    const operationName = data.name;
    const operationId = operationName.split('/').pop();

    return {
      provider_job_id: operationId,
      operation_name: operationName,
      status: data.done ? 'completed' : 'queued',
      model: modelName,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Check operation status
   */
  async getStatus(providerJobId, operationName) {
    // Use full operation name if available, otherwise construct it
    const opName = operationName || `operations/${providerJobId}`;

    const response = await fetch(
      `${this.baseUrl}/${opName}?key=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Veo status check failed: ${response.status}`);
    }

    const data = await response.json();

    const result = {
      provider_job_id: providerJobId,
      status: data.done ? 'completed' : 'in_progress',
      progress: data.metadata?.progress || 0
    };

    if (data.done && data.response) {
      const videos = data.response.generatedVideos || [];
      if (videos.length > 0) {
        result.video_url = videos[0].video?.uri;
        result.content_type = videos[0].video?.mimeType || 'video/mp4';
      }
    }

    if (data.error) {
      result.status = 'failed';
      result.error = data.error.message || 'Video generation failed';
    }

    return result;
  }

  /**
   * Map status
   */
  mapStatus(done, hasError) {
    if (hasError) return 'failed';
    if (done) return 'completed';
    return 'in_progress';
  }

  /**
   * Estimate cost (Vertex AI pricing varies)
   * Approximately $0.05-0.10 per second for Veo 3.1
   */
  estimateCost(durationSeconds, model) {
    const rates = {
      'veo-3.1-generate-preview': 0.08,
      'veo-3.1-fast-generate-preview': 0.05,
      'veo-3.0-generate-001': 0.06,
      'veo-2.0-generate-001': 0.04
    };
    const rate = rates[model] || rates['veo-3.1-generate-preview'];
    return parseFloat(durationSeconds) * rate;
  }
}
