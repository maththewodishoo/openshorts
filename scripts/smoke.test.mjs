/**
 * Functional checks for the OPEN CLIPS AI control plane.
 *
 * These exercise the real server process over HTTP: persistence to disk across
 * a restart, refusal to fabricate success, secret handling, and static serving.
 * Nothing here mocks the server — it is the same file deployed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3311 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;

let dataDir;
let child;

async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start: ${logs.join('')}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 4000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

const getJson = async (p, init) => {
  const res = await fetch(`${BASE}${p}`, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body, text };
};

test('control plane: state, persistence, honest failures, secret hygiene', async (t) => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocai-test-'));
  await startServer();
  t.after(async () => {
    await stopServer();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await t.test('health endpoint answers', async () => {
    const { res, body } = await getJson('/healthz');
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
  });

  await t.test('engine routes report BACKEND NOT CONFIGURED instead of faking work', async () => {
    const { res, body } = await getJson('/api/process', { method: 'POST' });
    assert.equal(res.status, 503);
    assert.equal(body.error.code, 'backend_not_configured');
    assert.match(body.error.message, /No OpenShorts processing backend/);
  });

  await t.test('campaign research refuses without a stored provider key', async () => {
    const { res, body } = await getJson('/api/app/research', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'setup_required');
    assert.match(body.error.message, /SETUP REQUIRED/);
  });

  await t.test('settings save, re-read and survive a server restart', async () => {
    const saved = await getJson('/api/app/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultClipCount: 7, defaultAspectRatio: '1:1', defaultCaptionStyle: 'neon' }),
    });
    assert.equal(saved.res.status, 200);
    assert.equal(saved.body.ok, true);

    const reread = await getJson('/api/app/state');
    assert.equal(reread.body.settings.defaultClipCount, 7);
    assert.equal(reread.body.settings.defaultAspectRatio, '1:1');
    assert.equal(reread.body.settings.defaultCaptionStyle, 'neon');

    // Prove it is on disk, not in memory.
    await stopServer();
    await startServer();
    const afterRestart = await getJson('/api/app/state');
    assert.equal(afterRestart.body.settings.defaultClipCount, 7);
    assert.equal(afterRestart.body.settings.defaultAspectRatio, '1:1');
  });

  await t.test('projects persist with their clips', async () => {
    const created = await getJson('/api/app/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Persisted project',
        jobId: 'job-123',
        status: 'completed',
        clips: [{ clipIndex: 0, title: 'Hook', start: 1, end: 30, score: 82 }],
      }),
    });
    assert.equal(created.res.status, 201);
    const id = created.body.project.id;
    assert.ok(id);

    const patched = await getJson(`/api/app/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed project' }),
    });
    assert.equal(patched.res.status, 200);

    await stopServer();
    await startServer();
    const state = await getJson('/api/app/state');
    const found = state.body.projects.find((p) => p.id === id);
    assert.ok(found, 'project survived restart');
    assert.equal(found.title, 'Renamed project');
    assert.equal(found.clips.length, 1);
  });

  await t.test('stored provider keys are never returned to the browser', async () => {
    const secret = 'test-secret-value-abc123';
    const saved = await getJson('/api/app/secrets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geminiKey: secret }),
    });
    assert.equal(saved.res.status, 200);
    assert.ok(!saved.text.includes(secret), 'save response leaked the key');

    const state = await getJson('/api/app/state');
    assert.equal(state.body.integrations.geminiKey, true, 'presence flag set');
    assert.ok(!state.text.includes(secret), 'state response leaked the key');

    const onDisk = await fs.readFile(path.join(dataDir, 'state.json'), 'utf8');
    assert.ok(!onDisk.includes(secret), 'key stored in plaintext in state.json');
  });

  await t.test('unknown API paths return a JSON 404, not HTML', async () => {
    const { res, body } = await getJson('/api/app/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(typeof body, 'object');
  });

  await t.test('the built frontend is served for app routes', async () => {
    const index = await fetch(`${BASE}/`);
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.match(html, /<div id="root">/);

    const deep = await fetch(`${BASE}/calendar`);
    assert.equal(deep.status, 200, 'SPA deep link served');
  });
});
