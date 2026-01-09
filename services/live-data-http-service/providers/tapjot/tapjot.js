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

  isConfigured() {
    return !!this.apiKey;
  }

  async request(method, endpoint, body = null) {
    if (!this.isConfigured()) {
      throw new Error('Tapjot API key not configured. Set TAPJOT_API_KEY in .env');
    }

    const url = `${BASE_URL}${endpoint}`;
    const options = {
      method,
      headers: {
        'x-api-key': this.apiKey,
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

  async listSnippets({ project_id, view_id, tag, limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (project_id) params.set('project_id', project_id);
    if (view_id) params.set('view_id', view_id);
    if (tag) params.set('tag', tag);
    if (limit) params.set('limit', limit.toString());
    if (offset) params.set('offset', offset.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request('GET', `/snippets${query}`);
  }

  async getSnippet(id) {
    return this.request('GET', `/snippets/${id}`);
  }

  async createSnippet({ content, project_id, title, tags, view_id, size }) {
    if (!content) throw new Error('content is required');
    if (!project_id) throw new Error('project_id is required');

    return this.request('POST', '/snippets', {
      content,
      project_id,
      title: title || '',
      tags: tags || [],
      view_id: view_id || '',
      size: size || 'medium',
    });
  }

  async updateSnippet(id, { content, title, tags, view_id, size }) {
    const updates = {};
    if (content !== undefined) updates.content = content;
    if (title !== undefined) updates.title = title;
    if (tags !== undefined) updates.tags = tags;
    if (view_id !== undefined) updates.view_id = view_id;
    if (size !== undefined) updates.size = size;

    return this.request('PATCH', `/snippets/${id}`, updates);
  }

  async deleteSnippet(id) {
    return this.request('DELETE', `/snippets/${id}`);
  }

  // ============================================================================
  // PROJECTS
  // ============================================================================

  async listProjects() {
    return this.request('GET', '/projects');
  }

  async getProject(id) {
    return this.request('GET', `/projects/${id}`);
  }

  async createProject({ name, description, visibility }) {
    if (!name) throw new Error('name is required');

    return this.request('POST', '/projects', {
      name,
      description: description || '',
      visibility: visibility || 'private',
    });
  }

  async updateProject(id, { name, description, visibility }) {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (visibility !== undefined) updates.visibility = visibility;

    return this.request('PATCH', `/projects/${id}`, updates);
  }

  async deleteProject(id) {
    return this.request('DELETE', `/projects/${id}`);
  }

  // ============================================================================
  // VIEWS (Tabs within projects)
  // ============================================================================

  async listViews({ project_id } = {}) {
    const params = project_id ? `?project_id=${project_id}` : '';
    return this.request('GET', `/views${params}`);
  }

  async getView(id) {
    return this.request('GET', `/views/${id}`);
  }

  async createView({ name, project_id, display_order }) {
    if (!name) throw new Error('name is required');
    if (!project_id) throw new Error('project_id is required');

    return this.request('POST', '/views', {
      name,
      project_id,
      display_order: display_order || Date.now(),
    });
  }

  async updateView(id, { name, display_order }) {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (display_order !== undefined) updates.display_order = display_order;

    return this.request('PATCH', `/views/${id}`, updates);
  }

  async deleteView(id) {
    return this.request('DELETE', `/views/${id}`);
  }
}

export default TapjotProvider;
