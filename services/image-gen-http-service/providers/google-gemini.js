import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Google Gemini Image Generation Provider (Nano Banana)
 *
 * Supports:
 * - gemini-3-pro-image (Nano Banana Pro) - Studio quality, 4K, best text rendering
 * - gemini-2.5-flash-image (Nano Banana) - Fast, efficient, 1024px
 *
 * Requires GOOGLE_AI_API_KEY environment variable
 */
export class GoogleGeminiProvider {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * Initialize the Google AI client
   */
  async initialize() {
    try {
      const apiKey = process.env.GOOGLE_AI_API_KEY;

      if (!apiKey) {
        throw new Error('GOOGLE_AI_API_KEY environment variable not set');
      }

      this.client = new GoogleGenerativeAI(apiKey);

      console.log('✅ Google Gemini (Nano Banana) initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Google Gemini:', error.message);
      throw new Error(`Google Gemini initialization failed: ${error.message}`);
    }
  }

  /**
   * Download image from URL to buffer
   */
  async downloadImage(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Generate image from text prompt using Gemini
   *
   * @param {Object} params
   * @param {string} params.prompt - Text description of the image
   * @param {string} [params.model] - Model to use (gemini-3-pro-image, gemini-2.5-flash-image)
   * @param {string} [params.size] - Image size (1024x1024, 1024x1792, etc)
   * @param {number} [params.n] - Number of images (1-4)
   * @param {string} [params.filename] - Custom filename prefix
   * @returns {Promise<Object>} Image data and metadata
   */
  async generateImage({ prompt, model, size, n, filename }) {
    if (!this.client) {
      await this.initialize();
    }

    // Default to Nano Banana Pro (best quality)
    const modelName = model || this.config.model || 'gemini-3-pro-image';
    const imageSize = size || this.config.size || '1024x1024';
    let numImages = n || 1;

    // Gemini supports 1-4 images per request
    if (numImages > 4) {
      console.warn(`⚠️  Gemini supports max 4 images. Generating 4 instead of ${numImages}`);
      numImages = 4;
    }

    try {
      // Get the generative model
      const genModel = this.client.getGenerativeModel({ model: modelName });

      // Build generation config
      const generationConfig = {
        candidateCount: numImages,
      };

      // Generate images - Gemini uses simple text prompts for image generation
      const result = await genModel.generateContent(prompt);

      const response = result.response;
      const candidates = response.candidates || [];

      if (candidates.length === 0) {
        throw new Error('No images generated');
      }

      // Process all generated images
      const images = [];
      const outputDir = path.resolve(process.cwd(), this.config.output_dir || './image-output');
      await fs.mkdir(outputDir, { recursive: true });

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];

        // Extract image data (base64 or URL)
        let imageBuffer;
        if (candidate.content?.parts?.[0]?.inlineData) {
          // Base64 encoded image
          const base64Data = candidate.content.parts[0].inlineData.data;
          imageBuffer = Buffer.from(base64Data, 'base64');
        } else if (candidate.content?.parts?.[0]?.fileData) {
          // File URI - need to download
          const fileUri = candidate.content.parts[0].fileData.fileUri;
          imageBuffer = await this.downloadImage(fileUri);
        } else {
          console.warn(`⚠️  Image ${i + 1} has unexpected format, skipping`);
          continue;
        }

        // Generate filename
        const timestamp = Date.now();
        const format = this.config.output_format || 'png';

        let filePrefix = 'gemini';
        if (filename) {
          filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
        }

        const indexSuffix = numImages > 1 ? `-${i + 1}` : '';
        const generatedFilename = `${filePrefix}${indexSuffix}-${timestamp}.${format}`;
        const filePath = path.join(outputDir, generatedFilename);

        // Write image file
        await fs.writeFile(filePath, imageBuffer);

        // Convert to base64
        const base64Image = imageBuffer.toString('base64');

        images.push({
          image_path: filePath,
          image_base64: base64Image,
          format: format,
          file_size_bytes: imageBuffer.length,
        });

        // Small delay between processing
        if (i < candidates.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Return result
      if (numImages === 1) {
        return {
          success: true,
          image_path: images[0].image_path,
          image_base64: images[0].image_base64,
          format: images[0].format,
          prompt: prompt,
          provider: 'google-gemini',
          model_used: modelName,
          size: imageSize,
          file_size_bytes: images[0].file_size_bytes,
        };
      } else {
        return {
          success: true,
          count: images.length,
          images: images,
          prompt: prompt,
          provider: 'google-gemini',
          model_used: modelName,
          size: imageSize,
        };
      }

    } catch (error) {
      console.error('❌ Google Gemini image generation failed:', error.message);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  /**
   * Edit an existing image (if supported by Gemini)
   */
  async editImage({ image, prompt, mask, size, n, filename }) {
    throw new Error('Image editing not yet implemented for Google Gemini');
  }
}
