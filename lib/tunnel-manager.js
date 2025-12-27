/**
 * Tunnel Manager
 *
 * Manages a Cloudflare Quick Tunnel as a child process.
 * Automatically detects tunnel URL from cloudflared output and emits events on URL changes.
 * Handles process crashes with automatic restart.
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');

class TunnelManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 3010;
    this.tunnelUrl = null;
    this.process = null;
    this.isStarting = false;
    this.restartAttempts = 0;
    this.maxRestartAttempts = options.maxRestartAttempts || 10;
    this.restartDelay = options.restartDelay || 5000;
  }

  /**
   * Start the cloudflared tunnel process
   */
  start() {
    if (this.process || this.isStarting) {
      console.log('⚠️  Tunnel already running or starting');
      return;
    }

    this.isStarting = true;
    console.log(`🚇 Starting Cloudflare tunnel on port ${this.port}...`);

    try {
      this.process = spawn('cloudflared', [
        'tunnel',
        '--url', `http://localhost:${this.port}`,
        '--no-autoupdate'
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Cloudflared outputs URL info to stderr
      this.process.stderr.on('data', (data) => {
        const output = data.toString();

        // Log cloudflared output (but not too verbose)
        if (output.includes('ERR') || output.includes('error')) {
          console.error('🚇 Cloudflared:', output.trim());
        }

        // Look for tunnel URL
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
          const newUrl = match[0];
          if (newUrl !== this.tunnelUrl) {
            const oldUrl = this.tunnelUrl;
            this.tunnelUrl = newUrl;
            console.log(`🔗 Tunnel URL detected: ${newUrl}`);
            this.emit('url-changed', newUrl, oldUrl);
            this.restartAttempts = 0; // Reset on successful URL detection
          }
        }
      });

      this.process.stdout.on('data', (data) => {
        // Usually empty, but log if there's anything
        const output = data.toString().trim();
        if (output) {
          console.log('🚇 Cloudflared stdout:', output);
        }
      });

      this.process.on('error', (error) => {
        console.error('❌ Failed to start cloudflared:', error.message);
        this.isStarting = false;
        this.process = null;
        this.emit('error', error);
        this.scheduleRestart();
      });

      this.process.on('exit', (code, signal) => {
        console.log(`⚠️  Cloudflared exited (code: ${code}, signal: ${signal})`);
        this.isStarting = false;
        this.process = null;
        this.tunnelUrl = null;
        this.emit('exit', code, signal);

        if (code !== 0) {
          this.scheduleRestart();
        }
      });

      this.isStarting = false;
      this.emit('started');

    } catch (error) {
      console.error('❌ Error spawning cloudflared:', error.message);
      this.isStarting = false;
      this.emit('error', error);
      this.scheduleRestart();
    }
  }

  /**
   * Schedule a restart after a delay
   */
  scheduleRestart() {
    this.restartAttempts++;

    if (this.restartAttempts > this.maxRestartAttempts) {
      console.error(`❌ Max restart attempts (${this.maxRestartAttempts}) reached. Giving up.`);
      this.emit('max-restarts-reached');
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 30s, 30s...
    const delays = [5000, 10000, 20000, 30000];
    const delay = delays[Math.min(this.restartAttempts - 1, delays.length - 1)];

    console.log(`🔄 Restarting tunnel in ${delay/1000}s (attempt ${this.restartAttempts}/${this.maxRestartAttempts})...`);

    setTimeout(() => {
      this.start();
    }, delay);
  }

  /**
   * Stop the tunnel process
   */
  stop() {
    if (this.process) {
      console.log('🛑 Stopping cloudflared tunnel...');
      this.process.kill('SIGTERM');
      this.process = null;
      this.tunnelUrl = null;
    }
  }

  /**
   * Get the current tunnel URL
   * @returns {string|null} Current tunnel URL or null if not available
   */
  getUrl() {
    return this.tunnelUrl;
  }

  /**
   * Check if tunnel is running and has a URL
   * @returns {boolean}
   */
  isReady() {
    return this.process !== null && this.tunnelUrl !== null;
  }

  /**
   * Wait for tunnel URL to be available
   * @param {number} timeout - Max time to wait in ms (default: 30000)
   * @returns {Promise<string>} Tunnel URL
   */
  waitForUrl(timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (this.tunnelUrl) {
        resolve(this.tunnelUrl);
        return;
      }

      const timer = setTimeout(() => {
        this.removeListener('url-changed', handler);
        reject(new Error('Timeout waiting for tunnel URL'));
      }, timeout);

      const handler = (url) => {
        clearTimeout(timer);
        resolve(url);
      };

      this.once('url-changed', handler);
    });
  }
}

module.exports = TunnelManager;
