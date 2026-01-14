/**
 * Tapjot API Provider
 *
 * Wraps the Tapjot Supabase Edge Function API for note-taking operations.
 * Requires API key from Tapjot Settings → API Keys.
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://mhqmrtvnqhjqvdrsbhgg.supabase.co/functions/v1/api/v1';

export class TapjotProvider {
  constructor(config = {}) {
    this.name = 'tapjot';
    this.apiKey = config.apiKey || process.env.TAPJOT_API_KEY;
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
      throw new Error('No API key provided. Pass api_keys.tapjot in request or set TAPJOT_API_KEY environment variable.');
    }
    return key;
  }

  /**
   * Make a request to the Tapjot API
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} [body] - Request body
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async request(method, endpoint, body = null, apiKey) {
    const key = this.getApiKey(apiKey);

    const url = `${BASE_URL}${endpoint}`;
    const options = {
      method,
      headers: {
        'x-api-key': key,
        'Content-Type': 'application/json',
      },
    };

    if (body && (method === 'POST' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    console.log(`📝 [Tapjot] ${method} ${endpoint}`);

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tapjot API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  // ============================================================================
  // SNIPPETS (Notes)
  // ============================================================================

  async listSnippets({ project_id, view_id, tag, limit = 50, offset = 0, apiKey } = {}) {
    const params = new URLSearchParams();
    if (project_id) params.set('project_id', project_id);
    if (view_id) params.set('view_id', view_id);
    if (tag) params.set('tag', tag);
    if (limit) params.set('limit', limit.toString());
    if (offset) params.set('offset', offset.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request('GET', `/snippets${query}`, null, apiKey);
  }

  async getSnippet(id, apiKey) {
    return this.request('GET', `/snippets/${id}`, null, apiKey);
  }

  async createSnippet({ content, project_id, title, tags, view_id, size, apiKey }) {
    if (!content) throw new Error('content is required');
    if (!project_id) throw new Error('project_id is required');

    return this.request('POST', '/snippets', {
      content,
      project_id,
      title: title || '',
      tags: tags || [],
      view_id: view_id || '',
      size: size || 'medium',
    }, apiKey);
  }

  async updateSnippet(id, { content, title, tags, view_id, size, apiKey }) {
    const updates = {};
    if (content !== undefined) updates.content = content;
    if (title !== undefined) updates.title = title;
    if (tags !== undefined) updates.tags = tags;
    if (view_id !== undefined) updates.view_id = view_id;
    if (size !== undefined) updates.size = size;

    return this.request('PATCH', `/snippets/${id}`, updates, apiKey);
  }

  async deleteSnippet(id, apiKey) {
    return this.request('DELETE', `/snippets/${id}`, null, apiKey);
  }

  // ============================================================================
  // PROJECTS
  // ============================================================================

  async listProjects(apiKey) {
    return this.request('GET', '/projects', null, apiKey);
  }

  async getProject(id, apiKey) {
    return this.request('GET', `/projects/${id}`, null, apiKey);
  }

  async createProject({ name, description, visibility, apiKey }) {
    if (!name) throw new Error('name is required');

    return this.request('POST', '/projects', {
      name,
      description: description || '',
      visibility: visibility || 'private',
    }, apiKey);
  }

  async updateProject(id, { name, description, visibility, apiKey }) {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (visibility !== undefined) updates.visibility = visibility;

    return this.request('PATCH', `/projects/${id}`, updates, apiKey);
  }

  async deleteProject(id, apiKey) {
    return this.request('DELETE', `/projects/${id}`, null, apiKey);
  }

  // ============================================================================
  // VIEWS (Tabs within projects)
  // ============================================================================

  async listViews({ project_id, apiKey } = {}) {
    const params = project_id ? `?project_id=${project_id}` : '';
    return this.request('GET', `/views${params}`, null, apiKey);
  }

  async getView(id, apiKey) {
    return this.request('GET', `/views/${id}`, null, apiKey);
  }

  async createView({ name, project_id, display_order, apiKey }) {
    if (!name) throw new Error('name is required');
    if (!project_id) throw new Error('project_id is required');

    return this.request('POST', '/views', {
      name,
      project_id,
      display_order: display_order || Date.now(),
    }, apiKey);
  }

  async updateView(id, { name, display_order, apiKey }) {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (display_order !== undefined) updates.display_order = display_order;

    return this.request('PATCH', `/views/${id}`, updates, apiKey);
  }

  async deleteView(id, apiKey) {
    return this.request('DELETE', `/views/${id}`, null, apiKey);
  }
}

export default TapjotProvider;
