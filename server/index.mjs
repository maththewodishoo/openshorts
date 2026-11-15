#!/usr/bin/env node
/**
 * OPEN CLIPS AI — control plane.
 *
 * The video engine stays where it belongs: in the OpenShorts Python/FastAPI
 * service (FFmpeg, faster-whisper, Gemini, face tracking). That service needs
 * several GB of RAM, model downloads and a persistent volume, so it is NOT run
 * here. This process is the app server that the browser talks to:
 *
 *   1. serves the built frontend (web/dist),
 *   2. persists application data (projects, settings, campaigns, social
 *      accounts, publishing queue) in a local JSON store with atomic writes,
 *   3. stores provider API keys encrypted at rest and NEVER returns them,
 *   4. proxies every engine call (/api/*, /videos/*, /thumbnails/*) to the
 *      configured OpenShorts backend and injects the stored keys as the
 *      headers the engine reads (X-Gemini-Key, X-Upload-Post-Key).
 *
 * If no backend is configured, engine routes answer 503 backend_not_configured.
 * Nothing is ever simulated: no fake progress, no fake publish success.
 *
 * Zero runtime dependencies (Node built-ins only) so the image stays small.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = process.env.WEB_DIST || path.join(ROOT, 'web', 'dist');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const KEY_FILE = path.join(DATA_DIR, '.secret');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ENV_BACKEND = (process.env.OPENSHORTS_BACKEND_URL || '').trim().replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  appName: 'OPEN CLIPS AI',
  defaultClipCount: 5,
  defaultClipDuration: 30,
  defaultAspectRatio: '9:16',
  defaultCaptionStyle: 'karaoke',
  defaultDetectionStyle: 'viral',
  defaultLayout: 'auto',
  autoHook: true,
  autoSubtitles: true,
  preferredPlatforms: [],
  notifications: { email: '', desktop: false, onPublish: true, onFailure: true },
  backendUrl: '',
  uploadPostUser: '',
};

const emptyState = () => ({
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  projects: [],
  campaigns: [],
  accounts: [],
  posts: [],
  secrets: {},
});

let state = emptyState();
let saveChain = Promise.resolve();

function loadState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    state = { ...emptyState(), ...parsed };
    state.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    state.settings.notifications = { ...DEFAULT_SETTINGS.notifications, ...(parsed.settings?.notifications || {}) };
    for (const key of ['projects', 'campaigns', 'accounts', 'posts']) {
      if (!Array.isArray(state[key])) state[key] = [];
    }
    if (!state.secrets || typeof state.secrets !== 'object') state.secrets = {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[state] unreadable, starting clean:', err.message);
    state = emptyState();
  }
}

// Serialised, atomic: a crash mid-write must not truncate the store.
function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  saveChain = saveChain.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, snapshot, 'utf8');
    await fsp.rename(tmp, STATE_FILE);
  }).catch((err) => console.error('[state] save failed:', err.message));
  return saveChain;
}

// ---------------------------------------------------------------------------
// secret encryption (AES-256-GCM, key derived from APP_SECRET or a local file)
// ---------------------------------------------------------------------------
let encKey = null;
function encryptionKey() {
  if (encKey) return encKey;
  let material = (process.env.APP_SECRET || '').trim();
  if (!material) {
    try {
      material = fs.readFileSync(KEY_FILE, 'utf8').trim();
    } catch {
      material = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(KEY_FILE, material, { mode: 0o600 });
    }
  }
  encKey = crypto.createHash('sha256').update(material).digest();
  return encKey;
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: enc.toString('base64') };
}

function decryptSecret(box) {
  if (!box || box.v !== 1) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

const getSecret = (name) => decryptSecret(state.secrets?.[name]);
const hasSecret = (name) => Boolean(getSecret(name));

// ---------------------------------------------------------------------------
// http helpers
// ---------------------------------------------------------------------------
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function fail(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v) => v === true || v === 'true';
const int = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const oneOf = (v, allowed, def) => (allowed.includes(v) ? v : def);

// ---------------------------------------------------------------------------
// engine (OpenShorts backend) resolution + proxy
// ---------------------------------------------------------------------------
function backendUrl() {
  const fromSettings = str(state.settings.backendUrl, 500).replace(/\/+$/, '');
  const url = fromSettings || ENV_BACKEND;
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

function backendInfo() {
  const url = backendUrl();
  return {
    configured: Boolean(url),
    url,
    source: url && url === ENV_BACKEND && !str(state.settings.backendUrl, 500) ? 'environment' : url ? 'settings' : 'none',
  };
}

function engineHeaders(req, extra = {}) {
  const headers = { ...extra };
  // The engine reads these for BYOK self-host deployments.
  const gemini = getSecret('geminiKey');
  const uploadPost = getSecret('uploadPostKey');
  if (gemini) headers['x-gemini-key'] = gemini;
  if (uploadPost) headers['x-upload-post-key'] = uploadPost;
  // Pass through the caller's own auth (cloud deployments use bearer tokens).
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  return headers;
}

function proxyToEngine(req, res, targetPath) {
  const base = backendUrl();
  if (!base) {
    return fail(
      res,
      503,
      'backend_not_configured',
      'No OpenShorts processing backend is connected. Add your backend URL in Settings, or set OPENSHORTS_BACKEND_URL. Video analysis, clip rendering and publishing all run on that backend.',
    );
  }

  let target;
  try {
    target = new URL(base + targetPath);
  } catch {
    return fail(res, 500, 'bad_backend_url', 'The configured backend URL is not a valid URL.');
  }

  const isHttps = target.protocol === 'https:';
  const headers = engineHeaders(req, { host: target.host });
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host', 'connection', 'accept-encoding', 'content-length'].includes(k)) continue;
    if (k.startsWith('x-') && (k === 'x-gemini-key' || k === 'x-upload-post-key')) continue;
    if (headers[k] === undefined && typeof v === 'string') headers[k] = v;
  }
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];

  const upstream = (isHttps ? https : http).request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
      timeout: 0,
    },
    (up) => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (['connection', 'transfer-encoding', 'keep-alive'].includes(k)) continue;
        outHeaders[k] = v;
      }
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    fail(res, 502, 'backend_unreachable', `The processing backend could not be reached (${err.code || err.message}). Check the backend URL and that the service is running.`);
  });

  // Multipart uploads stream straight through — no buffering of multi-GB files.
  req.pipe(upstream);
  req.on('aborted', () => upstream.destroy());
}

// ---------------------------------------------------------------------------
// app API
// ---------------------------------------------------------------------------
function publicState() {
  return {
    settings: state.settings,
    projects: state.projects,
    campaigns: state.campaigns,
    accounts: state.accounts,
    posts: state.posts,
    backend: backendInfo(),
    integrations: {
      geminiKey: hasSecret('geminiKey'),
      uploadPostKey: hasSecret('uploadPostKey'),
      uploadPostUser: str(state.settings.uploadPostUser, 120),
    },
    updatedAt: nowIso(),
  };
}

function analytics() {
  const clips = state.projects.reduce((n, p) => n + (Array.isArray(p.clips) ? p.clips.length : 0), 0);
  const published = state.posts.filter((p) => p.status === 'published');
  const failed = state.posts.filter((p) => p.status === 'failed');
  const scheduled = state.posts.filter((p) => p.status === 'scheduled');
  const attempted = published.length + failed.length;
  return {
    totals: {
      videosProcessed: state.projects.filter((p) => p.status === 'complete' || p.jobId).length,
      projects: state.projects.length,
      clipsGenerated: clips,
      clipsPublished: published.length,
      publishSuccessRate: attempted ? Math.round((published.length / attempted) * 100) : null,
      scheduledPosts: scheduled.length,
      connectedAccounts: state.accounts.filter((a) => a.status === 'connected').length,
      failedPosts: failed.length,
    },
    engagement: null, // filled from the engine when a provider is connected
    sources: {
      library: true,
      engine: backendInfo().configured,
      socialProvider: hasSecret('uploadPostKey'),
    },
  };
}

function upsert(list, record) {
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = { ...list[i], ...record };
  else list.push(record);
  return i >= 0 ? list[i] : record;
}

async function handleAppApi(req, res, url) {
  const parts = url.pathname.replace(/^\/api\/app\/?/, '').split('/').filter(Boolean);
  const [resource, id, action] = parts;
  const method = req.method || 'GET';

  if (resource === 'health') return sendJson(res, 200, { ok: true, backend: backendInfo() });

  if (resource === 'state' && method === 'GET') return sendJson(res, 200, publicState());
  if (resource === 'analytics' && method === 'GET') return sendJson(res, 200, analytics());

  // --- settings ------------------------------------------------------------
  if (resource === 'settings' && (method === 'PUT' || method === 'PATCH')) {
    const body = await readBody(req);
    const s = state.settings;
    if ('appName' in body) s.appName = str(body.appName, 60) || DEFAULT_SETTINGS.appName;
    if ('defaultClipCount' in body) s.defaultClipCount = int(body.defaultClipCount, s.defaultClipCount, 1, 30);
    if ('defaultClipDuration' in body) s.defaultClipDuration = int(body.defaultClipDuration, s.defaultClipDuration, 5, 180);
    if ('defaultAspectRatio' in body) s.defaultAspectRatio = oneOf(body.defaultAspectRatio, ['9:16', '16:9', '1:1', '4:5'], s.defaultAspectRatio);
    if ('defaultCaptionStyle' in body) s.defaultCaptionStyle = oneOf(body.defaultCaptionStyle, ['karaoke', 'bold', 'minimal', 'neon', 'professional'], s.defaultCaptionStyle);
    if ('defaultDetectionStyle' in body) s.defaultDetectionStyle = oneOf(body.defaultDetectionStyle, ['viral', 'educational', 'funny', 'emotional', 'storytelling', 'conversation', 'opinion', 'product', 'custom'], s.defaultDetectionStyle);
    if ('defaultLayout' in body) s.defaultLayout = oneOf(body.defaultLayout, ['auto', 'track', 'general', 'split', 'screencast', 'none'], s.defaultLayout);
    if ('autoHook' in body) s.autoHook = bool(body.autoHook);
    if ('autoSubtitles' in body) s.autoSubtitles = bool(body.autoSubtitles);
    if ('uploadPostUser' in body) s.uploadPostUser = str(body.uploadPostUser, 120);
    if ('preferredPlatforms' in body && Array.isArray(body.preferredPlatforms)) {
      s.preferredPlatforms = body.preferredPlatforms
        .filter((p) => ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'linkedin'].includes(p))
        .slice(0, 6);
    }
    if ('notifications' in body && body.notifications && typeof body.notifications === 'object') {
      s.notifications = {
        email: str(body.notifications.email, 160),
        desktop: bool(body.notifications.desktop),
        onPublish: bool(body.notifications.onPublish),
        onFailure: bool(body.notifications.onFailure),
      };
    }
    if ('backendUrl' in body) {
      const candidate = str(body.backendUrl, 500).replace(/\/+$/, '');
      if (candidate && !/^https?:\/\//i.test(candidate)) {
        return fail(res, 400, 'invalid_backend_url', 'The backend URL must start with http:// or https://');
      }
      s.backendUrl = candidate;
    }
    await saveState();
    return sendJson(res, 200, { ok: true, settings: state.settings, backend: backendInfo() });
  }

  // --- provider secrets (write-only) --------------------------------------
  if (resource === 'secrets' && method === 'POST') {
    const body = await readBody(req);
    const changed = [];
    for (const [field, name] of [['geminiKey', 'geminiKey'], ['uploadPostKey', 'uploadPostKey']]) {
      if (field in body) {
        const value = str(body[field], 400);
        if (!value) delete state.secrets[name];
        else state.secrets[name] = encryptSecret(value);
        changed.push(field);
      }
    }
    await saveState();
    return sendJson(res, 200, {
      ok: true,
      changed,
      integrations: {
        geminiKey: hasSecret('geminiKey'),
        uploadPostKey: hasSecret('uploadPostKey'),
      },
    });
  }

  // --- projects ------------------------------------------------------------
  if (resource === 'projects') {
    if (method === 'GET') return sendJson(res, 200, { projects: state.projects });

    if (method === 'POST') {
      const body = await readBody(req);
      const record = {
        id: str(body.id, 80) || uid(),
        title: str(body.title, 200) || 'Untitled project',
        source: {
          type: oneOf(body.source?.type, ['url', 'file'], 'url'),
          url: str(body.source?.url, 2000),
          filename: str(body.source?.filename, 300),
        },
        jobId: str(body.jobId, 120),
        status: oneOf(body.status, ['draft', 'processing', 'complete', 'failed'], 'draft'),
        error: str(body.error, 1000),
        config: body.config && typeof body.config === 'object' ? body.config : {},
        clips: Array.isArray(body.clips) ? body.clips.slice(0, 60) : [],
        campaignId: str(body.campaignId, 80),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const existing = state.projects.find((p) => p.id === record.id);
      if (existing) {
        Object.assign(existing, record, { createdAt: existing.createdAt, updatedAt: nowIso() });
        await saveState();
        return sendJson(res, 200, { ok: true, project: existing });
      }
      state.projects.unshift(record);
      await saveState();
      return sendJson(res, 201, { ok: true, project: record });
    }

    if (method === 'PATCH' && id) {
      const project = state.projects.find((p) => p.id === id);
      if (!project) return fail(res, 404, 'not_found', 'Project not found');
      const body = await readBody(req);
      if ('title' in body) project.title = str(body.title, 200) || project.title;
      if ('status' in body) project.status = oneOf(body.status, ['draft', 'processing', 'complete', 'failed'], project.status);
      if ('error' in body) project.error = str(body.error, 1000);
      if ('jobId' in body) project.jobId = str(body.jobId, 120);
      if (Array.isArray(body.clips)) project.clips = body.clips.slice(0, 60);
      if (body.config && typeof body.config === 'object') project.config = { ...project.config, ...body.config };
      project.updatedAt = nowIso();
      await saveState();
      return sendJson(res, 200, { ok: true, project });
    }

    if (method === 'DELETE' && id) {
      const before = state.projects.length;
      state.projects = state.projects.filter((p) => p.id !== id);
      state.posts = state.posts.filter((p) => p.projectId !== id);
      if (state.projects.length === before) return fail(res, 404, 'not_found', 'Project not found');
      await saveState();
      return sendJson(res, 200, { ok: true });
    }
  }

  // --- campaigns -----------------------------------------------------------
  if (resource === 'campaigns') {
    if (method === 'GET') return sendJson(res, 200, { campaigns: state.campaigns });
    if (method === 'POST') {
      const body = await readBody(req);
      const record = {
        id: str(body.id, 80) || uid(),
        title: str(body.title, 200) || 'Untitled campaign',
        url: str(body.url, 2000),
        description: str(body.description, 4000),
        brief: body.brief && typeof body.brief === 'object' ? body.brief : null,
        notes: str(body.notes, 4000),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (record.url && !/^https?:\/\//i.test(record.url)) {
        return fail(res, 400, 'invalid_url', 'The campaign URL must start with http:// or https://');
      }
      const existing = state.campaigns.find((c) => c.id === record.id);
      if (existing) {
        Object.assign(existing, record, { createdAt: existing.createdAt, updatedAt: nowIso() });
        await saveState();
        return sendJson(res, 200, { ok: true, campaign: existing });
      }
      state.campaigns.unshift(record);
      await saveState();
      return sendJson(res, 201, { ok: true, campaign: record });
    }
    if (method === 'DELETE' && id) {
      state.campaigns = state.campaigns.filter((c) => c.id !== id);
      await saveState();
      return sendJson(res, 200, { ok: true });
    }
  }

  // --- social accounts (metadata only; OAuth lives in the provider) --------
  if (resource === 'accounts') {
    if (method === 'GET') return sendJson(res, 200, { accounts: state.accounts });
    if (method === 'PUT' || method === 'POST') {
      const body = await readBody(req);
      const platform = oneOf(body.platform, ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'linkedin'], '');
      if (!platform) return fail(res, 400, 'invalid_platform', 'Unknown platform');
      const record = {
        id: `${platform}:${str(body.username, 120) || 'default'}`,
        platform,
        username: str(body.username, 120),
        displayName: str(body.displayName, 160),
        status: oneOf(body.status, ['connected', 'disconnected', 'pending', 'reauth'], 'disconnected'),
        permissions: Array.isArray(body.permissions) ? body.permissions.map((p) => str(p, 60)).slice(0, 20) : [],
        profile: str(body.profile, 120),
        updatedAt: nowIso(),
      };
      upsert(state.accounts, record);
      await saveState();
      return sendJson(res, 200, { ok: true, account: record });
    }
    if (method === 'DELETE' && id) {
      const platform = id.includes(':') ? id.split(':')[0] : id;
      const before = state.accounts.length;
      state.accounts = state.accounts.filter((a) => a.platform !== platform);
      if (state.accounts.length === before) return fail(res, 404, 'not_found', 'Account not found');
      await saveState();
      return sendJson(res, 200, { ok: true });
    }
  }

  // --- publishing queue ----------------------------------------------------
  if (resource === 'posts') {
    if (method === 'GET') return sendJson(res, 200, { posts: state.posts });
    if (method === 'POST') {
      const body = await readBody(req);
      const record = {
        id: str(body.id, 80) || uid(),
        projectId: str(body.projectId, 80),
        clipIndex: Number.isInteger(body.clipIndex) ? body.clipIndex : 0,
        clipTitle: str(body.clipTitle, 200),
        platforms: Array.isArray(body.platforms)
          ? body.platforms.filter((p) => ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'linkedin'].includes(p))
          : [],
        caption: str(body.caption, 2200),
        hashtags: str(body.hashtags, 400),
        scheduledFor: str(body.scheduledFor, 40),
        status: oneOf(body.status, ['draft', 'ready', 'scheduled', 'publishing', 'published', 'failed'], 'draft'),
        providerId: str(body.providerId, 200),
        providerResponse: body.providerResponse && typeof body.providerResponse === 'object' ? body.providerResponse : null,
        error: str(body.error, 1000),
        attempts: int(body.attempts, 0, 0, 20),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (!record.platforms.length) return fail(res, 400, 'no_platforms', 'Select at least one social account');
      state.posts.unshift(record);
      await saveState();
      return sendJson(res, 201, { ok: true, post: record });
    }
    if ((method === 'PATCH' || method === 'PUT') && id) {
      const post = state.posts.find((p) => p.id === id);
      if (!post) return fail(res, 404, 'not_found', 'Post not found');
      const body = await readBody(req);
      if ('caption' in body) post.caption = str(body.caption, 2200);
      if ('hashtags' in body) post.hashtags = str(body.hashtags, 400);
      if ('scheduledFor' in body) post.scheduledFor = str(body.scheduledFor, 40);
      if ('status' in body) post.status = oneOf(body.status, ['draft', 'ready', 'scheduled', 'publishing', 'published', 'failed'], post.status);
      if ('providerId' in body) post.providerId = str(body.providerId, 200);
      if ('error' in body) post.error = str(body.error, 1000);
      if ('attempts' in body) post.attempts = int(body.attempts, post.attempts, 0, 20);
      if ('providerResponse' in body) post.providerResponse = body.providerResponse || null;
      post.updatedAt = nowIso();
      await saveState();
      return sendJson(res, 200, { ok: true, post });
    }
    if (method === 'DELETE' && id) {
      const before = state.posts.length;
      state.posts = state.posts.filter((p) => p.id !== id);
      if (state.posts.length === before) return fail(res, 404, 'not_found', 'Post not found');
      await saveState();
      return sendJson(res, 200, { ok: true });
    }
  }

  return fail(res, 404, 'not_found', `Unknown app endpoint: ${url.pathname}`);
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req, res, url) {
  if (!fs.existsSync(DIST)) {
    return fail(res, 503, 'frontend_not_built', 'Frontend build missing. Run npm run build.');
  }
  const rel = decodeURIComponent(url.pathname);
  let filePath = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(DIST)) return fail(res, 403, 'forbidden', 'Forbidden');
  try {
    let stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || stat.isDirectory()) {
      // SPA fallback for client-side routes.
      filePath = path.join(DIST, 'index.html');
      stat = await fsp.stat(filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch {
    fail(res, 404, 'not_found', 'Not found');
  }
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------
loadState();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/app/')) return await handleAppApi(req, res, url);

    if (url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true, backend: backendInfo(), uptime: process.uptime() });
    }

    // Everything else under /api, plus media the engine serves, goes upstream.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/videos/') || url.pathname.startsWith('/thumbnails/') || url.pathname === '/health') {
      return proxyToEngine(req, res, url.pathname + url.search);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return fail(res, 405, 'method_not_allowed', 'Method not allowed');
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) fail(res, status, status === 500 ? 'internal_error' : 'bad_request', err.message || 'Unexpected error');
    else res.destroy();
  }
});

server.headersTimeout = 0;
server.requestTimeout = 0; // long video jobs and multi-GB uploads
server.listen(PORT, HOST, () => {
  const info = backendInfo();
  console.log(`OPEN CLIPS AI control plane on http://${HOST}:${PORT}`);
  console.log(`  data: ${DATA_DIR}`);
  console.log(`  engine: ${info.configured ? info.url + ` (${info.source})` : 'NOT CONFIGURED — set OPENSHORTS_BACKEND_URL or Settings → Backend'}`);
});

const shutdown = () => {
  server.close(() => saveState().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 4000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
