/**
 * In-memory job tracker for async video generation jobs
 * Tracks job status, polls providers, and stores results
 */

class JobTracker {
  constructor(options = {}) {
    this.jobs = new Map();
    this.ttlHours = options.ttlHours || 24;
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.maxPollAttempts = options.maxPollAttempts || 360; // 30 min at 5s intervals

    // Cleanup expired jobs every hour
    setInterval(() => this.cleanup(), 3600000);
  }

  /**
   * Create a new job entry
   */
  create(jobId, providerJobId, provider, metadata = {}) {
    const job = {
      id: jobId,
      provider_job_id: providerJobId,
      provider,
      status: 'queued',
      progress: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      poll_count: 0,
      result: null,
      error: null,
      metadata
    };
    this.jobs.set(jobId, job);
    return job;
  }

  /**
   * Get job by ID
   */
  get(jobId) {
    return this.jobs.get(jobId);
  }

  /**
   * Update job status
   */
  update(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    Object.assign(job, updates, { updated_at: new Date().toISOString() });
    return job;
  }

  /**
   * Mark job as in progress
   */
  setInProgress(jobId, progress = 0) {
    return this.update(jobId, { status: 'in_progress', progress });
  }

  /**
   * Mark job as completed with result
   */
  setCompleted(jobId, result) {
    return this.update(jobId, {
      status: 'completed',
      progress: 100,
      result
    });
  }

  /**
   * Mark job as failed with error
   */
  setFailed(jobId, error) {
    return this.update(jobId, {
      status: 'failed',
      error: typeof error === 'string' ? error : error.message
    });
  }

  /**
   * Increment poll count
   */
  incrementPoll(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.poll_count++;
      job.updated_at = new Date().toISOString();
    }
    return job;
  }

  /**
   * List all jobs (optionally filtered)
   */
  list(filter = {}) {
    let jobs = Array.from(this.jobs.values());

    if (filter.status) {
      jobs = jobs.filter(j => j.status === filter.status);
    }
    if (filter.provider) {
      jobs = jobs.filter(j => j.provider === filter.provider);
    }

    // Sort by created_at desc
    jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (filter.limit) {
      jobs = jobs.slice(0, filter.limit);
    }

    return jobs;
  }

  /**
   * Delete a job
   */
  delete(jobId) {
    return this.jobs.delete(jobId);
  }

  /**
   * Cleanup expired jobs
   */
  cleanup() {
    const now = Date.now();
    const ttlMs = this.ttlHours * 3600000;

    for (const [jobId, job] of this.jobs) {
      const createdAt = new Date(job.created_at).getTime();
      if (now - createdAt > ttlMs) {
        this.jobs.delete(jobId);
      }
    }
  }

  /**
   * Get stats
   */
  stats() {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      queued: jobs.filter(j => j.status === 'queued').length,
      in_progress: jobs.filter(j => j.status === 'in_progress').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length
    };
  }
}

// Singleton instance
export const jobTracker = new JobTracker();
export { JobTracker };
