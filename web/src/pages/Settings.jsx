import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save, AlertTriangle, KeyRound, Server, Bell, Sliders, CheckCircle2, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Card, CardHeader, Field, ChipGroup, Switch, Badge, Banner, Spinner, Empty } from '../ui';
import { PLATFORMS } from '../lib/utils';

const DETECTION = [
  { value: 'viral', label: 'Viral moments' },
  { value: 'educational', label: 'Educational' },
  { value: 'funny', label: 'Funny' },
  { value: 'emotional', label: 'Emotional' },
  { value: 'storytelling', label: 'Storytelling' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'opinion', label: 'Strong opinions' },
  { value: 'product', label: 'Product promo' },
  { value: 'custom', label: 'Custom' },
];
const CAPTIONS = [
  { value: 'karaoke', label: 'Karaoke' },
  { value: 'bold', label: 'Bold' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'neon', label: 'Neon' },
  { value: 'professional', label: 'Professional' },
];
const ASPECTS = ['9:16', '16:9', '1:1', '4:5'].map((v) => ({ value: v, label: v }));
const LAYOUTS = [
  { value: 'auto', label: 'Auto' },
  { value: 'track', label: 'Speaker track' },
  { value: 'general', label: 'Centre crop' },
  { value: 'split', label: 'Split' },
  { value: 'screencast', label: 'Screencast' },
  { value: 'none', label: 'Full frame' },
];

export default function Settings({ go }) {
  const { settings, integrations, backend, engine, saveSettings, saveSecrets, refresh, toast } = useApp();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [keys, setKeys] = useState({ geminiKey: '', uploadPostKey: '' });

  useEffect(() => {
    setForm({
      appName: settings.appName || 'OPEN CLIPS AI',
      defaultClipCount: settings.defaultClipCount ?? 5,
      defaultClipDuration: settings.defaultClipDuration ?? 30,
      defaultAspectRatio: settings.defaultAspectRatio || '9:16',
      defaultCaptionStyle: settings.defaultCaptionStyle || 'karaoke',
      defaultDetectionStyle: settings.defaultDetectionStyle || 'viral',
      defaultLayout: settings.defaultLayout || 'auto',
      autoHook: !!settings.autoHook,
      autoSubtitles: settings.autoSubtitles !== false,
      preferredPlatforms: settings.preferredPlatforms || [],
      notifications: {
        email: settings.notifications?.email || '',
        desktop: !!settings.notifications?.desktop,
        onPublish: settings.notifications?.onPublish !== false,
        onFailure: settings.notifications?.onFailure !== false,
      },
      backendUrl: settings.backendUrl || '',
      uploadPostUser: settings.uploadPostUser || '',
    });
  }, [settings]);

  if (!form) return <Spinner />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const persist = async () => {
    setError('');
    setOk('');
    if (form.defaultClipCount < 1 || form.defaultClipCount > 30) {
      setError('Clip count must be between 1 and 30.');
      return;
    }
    if (form.defaultClipDuration < 5 || form.defaultClipDuration > 180) {
      setError('Clip duration must be between 5 and 180 seconds.');
      return;
    }
    if (form.backendUrl && !/^https?:\/\//i.test(form.backendUrl)) {
      setError('The processing backend URL must start with http:// or https://');
      return;
    }
    setBusy('save');
    try {
      await saveSettings(form);
      setOk('Saved and re-read from the server — these values are now stored.');
      toast('ok', 'Settings saved.');
      refresh().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const persistKeys = async () => {
    setError('');
    setOk('');
    if (!keys.geminiKey && !keys.uploadPostKey) {
      setError('Enter at least one key to save.');
      return;
    }
    setBusy('keys');
    try {
      const res = await saveSecrets({
        ...(keys.geminiKey ? { geminiKey: keys.geminiKey.trim() } : {}),
        ...(keys.uploadPostKey ? { uploadPostKey: keys.uploadPostKey.trim() } : {}),
      });
      setKeys({ geminiKey: '', uploadPostKey: '' });
      setOk(`Keys stored server-side (encrypted). Updated: ${(res?.changed || []).join(', ') || 'none'}. They are never sent back to the browser.`);
      toast('ok', 'Provider keys saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const clearKey = async (name) => {
    setBusy(name);
    setError('');
    try {
      await saveSecrets({ [name]: '' });
      setOk(`${name} removed from the server.`);
      toast('ok', 'Key removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const togglePlatform = (id) =>
    set({
      preferredPlatforms: form.preferredPlatforms.includes(id)
        ? form.preferredPlatforms.filter((p) => p !== id)
        : [...form.preferredPlatforms, id],
    });

  return (
    <div className="stack">
      <Card>
        <CardHeader
          icon={Sliders}
          title="Application defaults"
          sub="Used to pre-fill every new project"
          action={<button type="button" className="btn primary sm" onClick={persist} disabled={busy === 'save'}>
            {busy === 'save' ? <Spinner size={14} /> : <Save size={14} />} Save defaults
          </button>}
        />
        {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}
        {ok ? <Banner tone="ok" icon={CheckCircle2}>{ok}</Banner> : null}

        <div className="g2">
          <Field label="App name">
            <input className="input" value={form.appName} onChange={(e) => set({ appName: e.target.value })} maxLength={60} />
          </Field>
          <Field label="Default aspect ratio">
            <ChipGroup options={ASPECTS} value={form.defaultAspectRatio} onChange={(v) => set({ defaultAspectRatio: v })} />
          </Field>
        </div>
        <div className="g2">
          <Field label="Default clip count" hint="1–30">
            <input
              className="input"
              type="number"
              min={1}
              max={30}
              value={form.defaultClipCount}
              onChange={(e) => set({ defaultClipCount: Number(e.target.value) })}
            />
          </Field>
          <Field label="Default clip duration (seconds)" hint="5–180">
            <input
              className="input"
              type="number"
              min={5}
              max={180}
              value={form.defaultClipDuration}
              onChange={(e) => set({ defaultClipDuration: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Default caption style">
          <ChipGroup options={CAPTIONS} value={form.defaultCaptionStyle} onChange={(v) => set({ defaultCaptionStyle: v })} />
        </Field>
        <Field label="Default AI detection style">
          <ChipGroup options={DETECTION} value={form.defaultDetectionStyle} onChange={(v) => set({ defaultDetectionStyle: v })} />
        </Field>
        <Field label="Default camera framing">
          <ChipGroup options={LAYOUTS} value={form.defaultLayout} onChange={(v) => set({ defaultLayout: v })} />
        </Field>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginTop: 6 }}>
          <Switch checked={form.autoHook} onChange={(v) => set({ autoHook: v })} label="Automatic hooks" />
          <Switch checked={form.autoSubtitles} onChange={(v) => set({ autoSubtitles: v })} label="Automatic subtitles" />
        </div>
      </Card>

      <Card>
        <CardHeader icon={SettingsIcon} title="Preferred publishing accounts" sub="Pre-selected on the publishing screen" />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${form.preferredPlatforms.includes(p.id) ? 'active' : ''}`}
              onClick={() => togglePlatform(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Field label="Upload-Post username" hint="The workspace user the engine publishes with.">
          <input className="input" value={form.uploadPostUser} onChange={(e) => set({ uploadPostUser: e.target.value })} />
        </Field>
      </Card>

      <Card>
        <CardHeader icon={Server} title="Processing backend" sub="The Python/FFmpeg engine runs separately from this web app" />
        <Banner tone={engine.status === 'online' ? 'ok' : 'warn'} icon={AlertTriangle}>
          {engine.status === 'online'
            ? 'Processing backend is responding.'
            : `BACKEND NOT CONFIGURED or unreachable${engine.message ? `: ${engine.message}` : ''}. Video processing cannot run until a compatible OpenShorts engine is connected.`}
        </Banner>
        <Field label="Backend URL" hint="Leave empty to use the BACKEND_URL environment variable.">
          <input
            className="input"
            value={form.backendUrl}
            onChange={(e) => set({ backendUrl: e.target.value })}
            placeholder="https://your-engine-host:8080"
          />
        </Field>
        <div className="small muted">
          Effective backend: {backend.url || 'not set'} ({backend.source}). Run it with{' '}
          <span className="mono">docker compose up</span> from the repository root; this host only serves the web app and
          persistence layer.
        </div>
      </Card>

      <Card>
        <CardHeader icon={KeyRound} title="API providers" sub="Stored encrypted on the server, never returned to the browser" />
        <div className="g2">
          <Field label="Gemini API key" hint={integrations.geminiKey ? 'A key is stored.' : 'Not configured — campaign research is disabled.'}>
            <input
              className="input"
              type="password"
              value={keys.geminiKey}
              onChange={(e) => setKeys({ ...keys, geminiKey: e.target.value })}
              placeholder={integrations.geminiKey ? '•••••••• (replace)' : 'AIza…'}
              autoComplete="off"
            />
          </Field>
          <Field label="Upload-Post API key" hint={integrations.uploadPostKey ? 'A key is stored.' : 'Not configured — publishing is disabled.'}>
            <input
              className="input"
              type="password"
              value={keys.uploadPostKey}
              onChange={(e) => setKeys({ ...keys, uploadPostKey: e.target.value })}
              placeholder={integrations.uploadPostKey ? '•••••••• (replace)' : 'up_…'}
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="btn primary sm" onClick={persistKeys} disabled={busy === 'keys'}>
            {busy === 'keys' ? <Spinner size={14} /> : <Save size={14} />} Save keys
          </button>
          {integrations.geminiKey ? (
            <button type="button" className="btn sm ghost" onClick={() => clearKey('geminiKey')} disabled={!!busy}>
              <Trash2 size={13} /> Remove Gemini key
            </button>
          ) : null}
          {integrations.uploadPostKey ? (
            <button type="button" className="btn sm ghost" onClick={() => clearKey('uploadPostKey')} disabled={!!busy}>
              <Trash2 size={13} /> Remove Upload-Post key
            </button>
          ) : null}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <Badge tone={integrations.geminiKey ? 'ok' : 'warn'}>{integrations.geminiKey ? 'Gemini ready' : 'Gemini missing'}</Badge>
          <Badge tone={integrations.uploadPostKey ? 'ok' : 'warn'}>{integrations.uploadPostKey ? 'Publishing ready' : 'Publishing missing'}</Badge>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          The engine also needs its own transcription/AI configuration (see README). Keys here are only used by this app's
          server for research and publishing calls.
        </div>
      </Card>

      <Card>
        <CardHeader icon={Bell} title="Notifications" sub="Stored preferences" />
        <div className="g2">
          <Field label="Email for notifications">
            <input
              className="input"
              type="email"
              value={form.notifications.email}
              onChange={(e) => set({ notifications: { ...form.notifications, email: e.target.value } })}
              placeholder="you@example.com"
            />
          </Field>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <Switch
              checked={form.notifications.desktop}
              onChange={(v) => set({ notifications: { ...form.notifications, desktop: v } })}
              label="Desktop alerts"
            />
            <Switch
              checked={form.notifications.onPublish}
              onChange={(v) => set({ notifications: { ...form.notifications, onPublish: v } })}
              label="On publish"
            />
            <Switch
              checked={form.notifications.onFailure}
              onChange={(v) => set({ notifications: { ...form.notifications, onFailure: v } })}
              label="On failure"
            />
          </div>
        </div>
        <div className="small muted">
          These preferences are stored. This build does not send email; publishing events are shown in the app instead.
        </div>
      </Card>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" onClick={persist} disabled={busy === 'save'}>
          {busy === 'save' ? <Spinner size={14} /> : <Save size={14} />} Save all settings
        </button>
      </div>
    </div>
  );
}
