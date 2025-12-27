/**
 * Simple Promise Queue
 * Ensures TTS requests are processed one at a time to prevent
 * concurrent API calls from multiple bots/sessions
 */

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxQueueSize = 50; // Prevent memory issues from unbounded queue growth
    this.requestTimeout = 90000; // 90 seconds max per request (includes queue wait time)
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Async function to execute
   * @returns {Promise} Result of the request
   */
  async add(requestFn) {
    return new Promise((resolve, reject) => {
      // Reject if queue is too large to prevent memory issues
      if (this.queue.length >= this.maxQueueSize) {
        const error = new Error(`Queue is full (${this.maxQueueSize} requests). Try again later.`);
        console.error(`❌ [Queue] ${error.message}`);
        reject(error);
        return;
      }

      const startTime = Date.now();

      // Add timeout for this request
      const timeoutId = setTimeout(() => {
        const queueIndex = this.queue.findIndex(item => item.requestFn === requestFn);
        if (queueIndex !== -1) {
          // Remove from queue if still waiting
          this.queue.splice(queueIndex, 1);
          const error = new Error(`Request timeout after ${this.requestTimeout}ms (may have been waiting in queue)`);
          console.error(`❌ [Queue] ${error.message} - Queue length: ${this.queue.length}`);
          reject(error);
        }
      }, this.requestTimeout);

      // Log queue status if getting backed up
      if (this.queue.length > 5) {
        console.warn(`⚠️  [Queue] ${this.queue.length} requests waiting`);
      }

      this.queue.push({
        requestFn,
        resolve: (result) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;
          if (duration > 10000) {
            console.warn(`⚠️  [Queue] Request took ${duration}ms (including queue wait time)`);
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

  /**
   * Process the next request in the queue
   */
  async processNext() {
    // If already processing or queue is empty, return
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
      // Process next item in queue
      this.processNext();
    }
  }

  /**
   * Get current queue length
   */
  get length() {
    return this.queue.length;
  }
}

// Export singleton instance
export const requestQueue = new RequestQueue();
