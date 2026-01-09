/**
 * Simple Promise Queue
 * Ensures transcription requests are processed one at a time to prevent
 * concurrent API calls from multiple bots/sessions
 */

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxQueueSize = 20; // Smaller queue for transcription (larger files)
    this.requestTimeout = 300000; // 5 minutes max per request (transcription can be slow)
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Async function to execute
   * @returns {Promise} Result of the request
   */
  async add(requestFn) {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.maxQueueSize) {
        const error = new Error(`Queue is full (${this.maxQueueSize} requests). Try again later.`);
        console.error(`  [Queue] ${error.message}`);
        reject(error);
        return;
      }

      const startTime = Date.now();

      const timeoutId = setTimeout(() => {
        const queueIndex = this.queue.findIndex(item => item.requestFn === requestFn);
        if (queueIndex !== -1) {
          this.queue.splice(queueIndex, 1);
          const error = new Error(`Request timeout after ${this.requestTimeout}ms`);
          console.error(`  [Queue] ${error.message}`);
          reject(error);
        }
      }, this.requestTimeout);

      if (this.queue.length > 3) {
        console.warn(`   [Queue] ${this.queue.length} transcription requests waiting`);
      }

      this.queue.push({
        requestFn,
        resolve: (result) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;
          if (duration > 60000) {
            console.warn(`   [Queue] Request took ${(duration/1000).toFixed(1)}s`);
          }
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        startTime
      });
      this.processNext();
    });
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const { requestFn, resolve, reject } = this.queue.shift();

    try {
      const result = await requestFn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.processing = false;
      this.processNext();
    }
  }

  get length() {
    return this.queue.length;
  }
}

export const requestQueue = new RequestQueue();
