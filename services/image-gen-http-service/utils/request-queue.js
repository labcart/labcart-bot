/**
 * Simple Promise Queue
 * Ensures image generation requests are processed one at a time to prevent
 * concurrent API calls from multiple bots/sessions
 */

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Async function to execute
   * @returns {Promise} Result of the request
   */
  async add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
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
