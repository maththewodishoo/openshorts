/**
 * Single HTTP client for both planes:
 *  - /api/app/*  → the control plane (settings, projects, campaigns, accounts, posts)
 *  - /api/*      → the OpenShorts engine, proxied by the control plane
 *
 * Every failure surfaces as an ApiError carrying the server's real message, so
 * the UI never has to invent an error string and never shows a false success.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 400) };
    }
  }
  if (!res.ok) {
    let message = data?.error?.message;
    if (!message && typeof data?.detail === 'string') message = data.detail;
    if (!message && Array.isArray(data?.detail)) {
      message = data.detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
    }
    if (!message) message = `Request failed with HTTP ${res.status}`;
    throw new ApiError(message, {
      status: res.status,
      code: data?.error?.code || `http_${res.status}`,
      payload: data,
    });
  }
  return data;
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const opts = { method, headers: { ...headers }, signal };
  if (body instanceof FormData) {
    opts.body = body; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the app server. Check your connection and try again.', {
      code: 'network_error',
    });
  }
  return parseResponse(res);
}

export const api = {
  // ---- control plane -------------------------------------------------------
  state: () => request('/api/app/state'),
  analytics: () => request('/api/app/analytics'),
  saveSettings: (patch) => request('/api/app/settings', { method: 'PUT', body: patch }),
  saveSecrets: (secrets) => request('/api/app/secrets', { method: 'POST', body: secrets }),

  createProject: (project) => request('/api/app/projects', { method: 'POST', body: project }),
  updateProject: (id, patch) => request(`/api/app/projects/${id}`, { method: 'PATCH', body: patch }),
  deleteProject: (id) => request(`/api/app/projects/${id}`, { method: 'DELETE' }),

  createCampaign: (campaign) => request('/api/app/campaigns', { method: 'POST', body: campaign }),
  deleteCampaign: (id) => request(`/api/app/campaigns/${id}`, { method: 'DELETE' }),

  saveAccount: (account) => request('/api/app/accounts', { method: 'PUT', body: account }),
  deleteAccount: (id) => request(`/api/app/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createPost: (post) => request('/api/app/posts', { method: 'POST', body: post }),
  updatePost: (id, patch) => request(`/api/app/posts/${id}`, { method: 'PATCH', body: patch }),
  deletePost: (id) => request(`/api/app/posts/${id}`, { method: 'DELETE' }),

  // ---- engine (proxied) ----------------------------------------------------
  /** True when a processing backend is reachable. Never fakes a positive. */
  async probeEngine() {
    try {
      const res = await fetch('/health', { method: 'GET' });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => null);
      return {
        ok: false,
        code: data?.error?.code || `http_${res.status}`,
        message: data?.error?.message || `Backend responded ${res.status}`,
      };
    } catch (err) {
      return { ok: false, code: 'network_error', message: err.message };
    }
  },

  /**
   * Start a clipping job. Uses multipart when a File is present so multi-GB
   * uploads stream; JSON for link imports.
   */
  startJob: ({ file, url, config, signal, onUploadProgress }) => {
    const payload = {
      acknowledged: true,
      output_format: config.outputFormat,
      target_clips: String(config.clipCount),
      clip_min_seconds: String(config.clipDuration),
      clip_max_seconds: String(config.clipDuration),
      auto_hook: config.autoHook ? 'true' : 'false',
      auto_hook_style: config.detectionStyle,
      captions: config.autoSubtitles ? 'true' : 'false',
      layouts: config.framing || 'auto',
    };

    if (file) {
      const form = new FormData();
      form.append('file', file, file.name);
      for (const [k, v] of Object.entries(payload)) form.append(k, v);
      // fetch() cannot report upload progress; XMLHttpRequest can, and the
      // upload of a long video is exactly where the user needs a real number.
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/process');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onUploadProgress) {
            onUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          let data = null;
          try {
            data = JSON.parse(xhr.responseText || '{}');
          } catch {
            data = null;
          }
          if (xhr.status >= 200 && xhr.status < 300 && data?.job_id) return resolve(data);
          const message =
            data?.error?.message ||
            (typeof data?.detail === 'string' ? data.detail : null) ||
            `Upload failed with HTTP ${xhr.status}`;
          reject(
            new ApiError(message, {
              status: xhr.status,
              code: data?.error?.code || `http_${xhr.status}`,
              payload: data,
            }),
          );
        };
        xhr.onerror = () =>
          reject(new ApiError('The upload was interrupted. Check your connection and try again.', { code: 'network_error' }));
        xhr.onabort = () =>
          reject(new ApiError('Upload cancelled.', { code: 'aborted' }));
        if (signal) {
          signal.addEventListener('abort', () => xhr.abort(), { once: true });
        }
        xhr.send(form);
      });
    }

    return request('/api/process', { method: 'POST', body: { ...payload, url }, signal });
  },

  jobStatus: (jobId, signal) => request(`/api/status/${encodeURIComponent(jobId)}`, { signal }),

  /** Re-render a clip from edited boundaries (engine recut endpoint). */
  rerenderClip: ({ jobId, clipIndex, segments, framing, reapplyCaptions = true }) =>
    request('/api/clip/rerender', {
      method: 'POST',
      body: {
        job_id: jobId,
        clip_index: clipIndex,
        segments,
        snap_to_words: true,
        reapply_captions: reapplyCaptions,
        framing: framing || null,
      },
    }),

  regenerateClip: ({ jobId, clipIndex, instruction }) =>
    request('/api/clip/regenerate', {
      method: 'POST',
      body: { job_id: jobId, clip_index: clipIndex, instruction },
    }),

  subtitleStyles: (jobId, clipIndex) =>
    request(`/api/clip/${encodeURIComponent(jobId)}/${clipIndex}/transcript`),

  restyleSubtitles: ({ jobId, clipIndex, style }) =>
    request('/api/subtitle', {
      method: 'POST',
      body: { job_id: jobId, clip_index: clipIndex, style },
    }),

  /** Publishing goes to the engine's Upload-Post integration. */
  publish: (body) => request('/api/social/post', { method: 'POST', body }),

  uploadPostUser: () => request('/api/social/user'),

  /** Ask the engine to research a campaign URL with its LLM backend. */
  research: (body) => request('/api/campaign/research', { method: 'POST', body }),
};
