import React, { useEffect, useRef, useState } from 'react';
import {
  Link2, UploadCloud, X, Server, Sparkles, AlertTriangle, CheckCircle2, Film, Ban, ListChecks, Wand2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, getDraft, setDraft, readActiveJob, writeActiveJob } from '../lib/store';
import { Card, CardHeader, Field, ChipGroup, Switch, Badge, Banner, Progress, Spinner, Tabs, Empty } from '../ui';
import {
  ASPECTS, engineFormat, validateVideoUrl, validateVideoFile, formatBytes, normalizeClip, URL_SOURCES, MAX_UPLOAD_BYTES,
} from '../lib/utils';
import { CAPTION_PRESETS, presetFor } from '../components/ClipEditor';

const CLIP_COUNTS = [3, 5, 10, 15, 20, 'custom'];
const DURATIONS = [15, 30, 45, 60, 90, 'custom'];
const DETECTIONS = [
  { value: 'viral', label: 'Viral moments' },
  { value: 'educational', label: 'Educational' },
  { value: 'funny', label: 'Funny' },
  { value: 'emotional', label: 'Emotional' },
  { value: 'storytelling', label: 'Storytelling' },
  { value: 'conversation', label: 'Conversations' },
  { value: 'opinion', label: 'Strong opinions' },
  { value: 'product', label: 'Product promo' },
  { value: 'custom', label: 'Custom' },
];
const FRAMINGS = [
  { value: 'track', label: 'Active speaker / face tracking' },
  { value: 'auto', label: 'Centre crop' },
  { value: 'full', label: 'Full-frame crop' },
];
// Settings the engine's /api/process + FFmpeg pipeline does not expose. Shown
// disabled with the reason instead of pretending to be selectable.
const NOT_EXPOSED = [
  { label: 'Keyword highlighting', why: 'needs a word-level styling pass the engine does not expose' },
  { label: 'Silence removal', why: 'not implemented in this engine build' },
  { label: 'Filler-word removal', why: 'not implemented in this engine build' },
  { label: 'Automatic zoom', why: 'requires the paid effects provider' },
  { label: 'Custom logo / branding overlay', why: 'no overlay endpoint in this engine build' },
  { label: 'Custom opening & closing text', why: 'use the per-clip hook field instead' },
];

const chipLabel = (v, suffix) => (v === 'custom' ? 'Custom' : `${v}${suffix}`);

export default function NewProject({ go }) {
  const { settings, backend, engine, refresh, toast } = useApp();
  const draft = getDraft();

  const [method, setMethod] = useState(draft.url ? 'url' : draft.file ? 'file' : 'url');
  const [url, setUrl] = useState(draft.url || '');
  const [file, setFile] = useState(draft.file || null);
  const [config, setConfig] = useState(
    () =>
      draft.config || {
        clipCount: settings.defaultClipCount || 5,
        customCount: 8,
        clipDuration: settings.defaultClipDuration || 30,
        customDuration: 40,
        aspect: settings.defaultAspect || '9:16',
        captionStyle: settings.defaultCaptionStyle || 'bold',
        detectionStyle: settings.defaultDetectionStyle || 'viral',
        framing: settings.defaultFraming || 'track',
        autoHook: true,
        autoSubtitles: true,
        customInstructions: '',
      },
  );

  const [job, setJob] = useState(() => readActiveJob());
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [done, setDone] = useState(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);

  // Draft survives page changes: the uploaded File stays in the module store.
  useEffect(() => {
    setDraft({ url, file, config });
  }, [url, file, config]);

  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const effectiveCount = config.clipCount === 'custom' ? Number(config.customCount) || 0 : Number(config.clipCount) || 0;
  const effectiveDuration = config.clipDuration === 'custom' ? Number(config.customDuration) || 0 : Number(config.clipDuration) || 0;

  const finishJob = async (s, jobRef) => {
    const raw = s?.result?.clips || [];
    const clips = raw.map((c, i) => normalizeClip(c, i));
    const finalClips = [...clips];

    if (config.autoSubtitles && config.captionStyle && config.captionStyle !== 'bold' && finalClips.length) {
      const preset = presetFor(config.captionStyle);
      const limit = Math.min(finalClips.length, 6);
      setPhase(`Burning “${preset}” captions (${limit}/${finalClips.length})`);
      for (let i = 0; i < limit; i += 1) {
        try {
          const res = await api.restyleSubtitles({ jobId: jobRef.jobId, clipIndex: i, preset });
          const u = res?.video_url || res?.clip?.video_url || res?.url;
          finalClips[i] = { ...finalClips[i], captionStyle: config.captionStyle, ...(u ? { videoUrl: u } : {}) };
        } catch (err) {
          setLogs((l) => [...l, `Caption pass skipped for clip ${i + 1}: ${err.message}`]);
        }
      }
    }

    setPhase('');
    await api
      .updateProject(jobRef.projectId, {
        status: 'complete',
        clips: finalClips,
        jobId: jobRef.jobId,
        completedAt: new Date().toISOString(),
      })
      .catch(() => {});
    writeActiveJob(null);
    setJob(null);
    setDone({ projectId: jobRef.projectId, count: finalClips.length });
    refresh().catch(() => {});
    toast(
      finalClips.length ? 'ok' : 'warn',
      finalClips.length
        ? `${finalClips.length} clips rendered by the backend.`
        : 'The engine finished but returned no clips. Open the project log to see why.',
    );
  };

  const failJob = async (s, jobRef) => {
    const message = s?.error || s?.message || s?.detail || 'Processing failed on the backend.';
    await api.updateProject(jobRef.projectId, { status: 'failed', error: String(message) }).catch(() => {});
    writeActiveJob(null);
    setJob(null);
    setError(String(message));
    refresh().catch(() => {});
  };

  useEffect(() => {
    if (!job?.jobId) return undefined;
    let stopped = false;
    let timer = null;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const s = await api.jobStatus(job.jobId, controller.signal);
        if (stopped) return;
        setStatus(s);
        setLogs(Array.isArray(s.logs) ? s.logs.slice(-40) : []);
        const st = String(s.status || '').toLowerCase();
        if (['completed', 'complete', 'done', 'success', 'finished'].includes(st)) {
          await finishJob(s, job);
          return;
        }
        if (['failed', 'error', 'cancelled', 'canceled'].includes(st)) {
          await failJob(s, job);
          return;
        }
        timer = setTimeout(tick, 3000);
      } catch (err) {
        if (stopped || err.name === 'AbortError') return;
        setError(err.message);
        timer = setTimeout(tick, 6000);
      }
    };

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.jobId]);

  const start = async () => {
    setError('');
    setDone(null);
    if (!backend.configured) {
      setError('BACKEND NOT CONFIGURED. Add your OpenShorts processing backend URL in Settings → Processing backend.');
      return;
    }
    const check = method === 'url' ? validateVideoUrl(url) : validateVideoFile(file);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (!(effectiveCount > 0)) return setError('Choose how many clips you want.');
    if (!(effectiveDuration >= 5)) return setError('Clip duration must be at least 5 seconds.');

    setStarting(true);
    setUploadPct(0);
    const title =
      method === 'url'
        ? url.replace(/^https?:\/\//, '').slice(0, 70)
        : file.name.replace(/\.[^.]+$/, '').slice(0, 70);

    let project;
    try {
      const created = await api.createProject({
        title,
        status: 'processing',
        source: { type: method, url: method === 'url' ? url : '', filename: method === 'file' ? file.name : '' },
        config: { ...config, clipCount: effectiveCount, clipDuration: effectiveDuration },
      });
      project = created.project;
    } catch (err) {
      setError(err.message);
      setStarting(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await api.startJob({
        file: method === 'file' ? file : null,
        url: method === 'url' ? url : undefined,
        config: {
          outputFormat: engineFormat(config.aspect),
          clipCount: effectiveCount,
          clipDuration: effectiveDuration,
          detectionStyle: config.detectionStyle === 'custom' ? config.customInstructions || 'custom' : config.detectionStyle,
          autoHook: config.autoHook,
          autoSubtitles: config.autoSubtitles,
          framing: config.framing,
        },
        signal: controller.signal,
        onUploadProgress: setUploadPct,
      });
      const jobInfo = { jobId: res.job_id, projectId: project.id, title, startedAt: new Date().toISOString() };
      writeActiveJob(jobInfo);
      setJob(jobInfo);
      await api.updateProject(project.id, { jobId: res.job_id, status: 'processing' });
      refresh().catch(() => {});
      toast('ok', 'Job queued on the processing backend.');
    } catch (err) {
      if (err.code === 'aborted') {
        await api.updateProject(project.id, { status: 'failed', error: 'Upload cancelled by the user.' }).catch(() => {});
        setError('Upload cancelled.');
      } else {
        await api.updateProject(project.id, { status: 'failed', error: err.message }).catch(() => {});
        setError(err.message);
      }
    } finally {
      abortRef.current = null;
      setStarting(false);
    }
  };

  const cancelUpload = () => abortRef.current?.abort();

  const clearFile = () => {
    setFile(null);
    setDraft({ file: null });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const busy = !!job || starting;
  const statusText = status?.status || (starting ? 'uploading' : 'idle');
  const progress = starting && uploadPct < 100 ? uploadPct : status?.progress ?? (starting ? 0 : 0);

  return (
    <div className="stack">
      {!backend.configured ? (
        <Banner tone="err" icon={Server}>
          <strong>BACKEND NOT CONFIGURED.</strong> Nothing will be processed until you point this app at your
          OpenShorts backend (Docker image with FFmpeg + faster-whisper). Set it in Settings → Processing backend.
        </Banner>
      ) : engine.status !== 'online' ? (
        <Banner tone="warn" icon={AlertTriangle}>
          The backend URL is saved but not answering right now. Check that the container is running and reachable.
        </Banner>
      ) : null}

      {job ? (
        <Card>
          <CardHeader icon={Sparkles} title="Processing on the backend" sub={`Job ${job.jobId}`} action={<Badge tone="info">{statusText}</Badge>} />
          <Progress value={starting && uploadPct < 100 ? uploadPct : progress} />
          <div className="small muted" style={{ marginTop: 8 }}>
            {starting && uploadPct < 100 ? `Uploading file… ${uploadPct}%` : phase || status?.message || 'Waiting for the engine…'}
          </div>
          {status?.queue_position ? <div className="small muted">Queue position {status.queue_position}</div> : null}
          {logs.length ? <div className="logs">{logs.slice(-8).map((line, i) => <div key={i}>{line}</div>)}</div> : null}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            {starting ? (
              <button type="button" className="btn sm danger" onClick={cancelUpload}>
                <X size={14} /> Cancel upload
              </button>
            ) : (
              <span className="small muted">You can leave this page — the job keeps running and resumes polling when you return.</span>
            )}
          </div>
        </Card>
      ) : null}

      {done ? (
        <Banner tone={done.count ? 'ok' : 'warn'} icon={done.count ? CheckCircle2 : AlertTriangle}>
          {done.count ? `${done.count} clips are ready.` : 'The job finished without clips.'}{' '}
          <button type="button" className="btn sm primary" style={{ marginLeft: 8 }} onClick={() => go('clips')}>
            Open My Clips
          </button>
        </Banner>
      ) : null}

      <Card>
        <CardHeader icon={Link2} title="Import a video" sub="Link or file — both go straight to the engine" />
        <Tabs
          value={method}
          onChange={setMethod}
          tabs={[
            { value: 'url', label: 'Paste video link' },
            { value: 'file', label: 'Upload file' },
          ]}
        />

        {method === 'url' ? (
          <div style={{ marginTop: 14 }}>
            <Field label="Video URL" hint="YouTube, TikTok, Instagram, Facebook, X, Twitch, Vimeo — fetched by the engine's yt-dlp importer.">
              <input
                className="input"
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError('');
                }}
              />
            </Field>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {URL_SOURCES.map((s) => (
                <Badge key={s.id}>{s.label}</Badge>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              Platforms that require a login, or that block downloads, will fail on the engine with its own error. If that
              happens, download the file yourself where the platform allows it and upload it instead.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            {file ? (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{file.name}</div>
                  <div className="small muted">{formatBytes(file.size)} · kept while you switch pages</div>
                </div>
                <button type="button" className="btn sm" onClick={clearFile}>
                  <X size={14} /> Remove
                </button>
              </div>
            ) : (
              <label className="dropzone" style={{ display: 'block', cursor: 'pointer' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    if (!f) return;
                    const check = validateVideoFile(f);
                    if (!check.ok) {
                      setError(check.message);
                      return;
                    }
                    setError('');
                    setFile(f);
                    setDraft({ file: f });
                  }}
                />
                <UploadCloud size={26} style={{ color: 'var(--cyan)' }} />
                <div style={{ fontWeight: 600, marginTop: 8 }}>Choose a video file</div>
                <div className="small muted">MP4, MOV, MKV or WEBM · up to {formatBytes(MAX_UPLOAD_BYTES)}</div>
              </label>
            )}
            {starting && uploadPct > 0 && uploadPct < 100 ? (
              <div style={{ marginTop: 10 }}>
                <Progress value={uploadPct} />
                <div className="small muted">Uploading… {uploadPct}%</div>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader icon={Wand2} title="AI clipping configuration" sub="Only options the connected engine can execute are enabled" />

        <Field label="Number of clips">
          <ChipGroup options={CLIP_COUNTS} value={config.clipCount} onChange={(v) => set({ clipCount: v })} />
        </Field>
        {config.clipCount === 'custom' ? (
          <Field label="Custom clip count">
            <input className="input" type="number" min="1" max="50" value={config.customCount} onChange={(e) => set({ customCount: e.target.value })} />
          </Field>
        ) : null}

        <Field label="Clip duration">
          <ChipGroup options={DURATIONS} value={config.clipDuration} onChange={(v) => set({ clipDuration: v })} />
        </Field>
        {config.clipDuration === 'custom' ? (
          <Field label="Custom duration (seconds)" hint="Used as both the minimum and maximum clip length.">
            <input className="input" type="number" min="5" max="600" value={config.customDuration} onChange={(e) => set({ customDuration: e.target.value })} />
          </Field>
        ) : null}

        <Field label="Video format">
          <ChipGroup options={ASPECTS.map((a) => ({ value: a.value, label: a.label }))} value={config.aspect} onChange={(v) => set({ aspect: v })} />
        </Field>

        <Field label="AI detection style" hint="Guides the moment-selection prompt on the engine.">
          <ChipGroup options={DETECTIONS} value={config.detectionStyle} onChange={(v) => set({ detectionStyle: v })} />
        </Field>
        {config.detectionStyle === 'custom' ? (
          <Field label="Custom instructions">
            <textarea
              className="textarea"
              rows={3}
              placeholder="e.g. Prefer arguments about pricing, skip the intro"
              value={config.customInstructions}
              onChange={(e) => set({ customInstructions: e.target.value })}
            />
          </Field>
        ) : null}

        <Field label="Caption style" hint="Burned in with the engine's subtitle pass after the clips are cut.">
          <ChipGroup options={CAPTION_PRESETS} value={config.captionStyle} onChange={(v) => set({ captionStyle: v })} />
        </Field>

        <Field label="Camera framing">
          <ChipGroup options={FRAMINGS} value={config.framing} onChange={(v) => set({ framing: v })} />
        </Field>

        <div className="stack" style={{ marginTop: 6 }}>
          <Switch checked={config.autoHook} onChange={(v) => set({ autoHook: v })} label="Automatic hooks (engine writes an opening hook)" />
          <Switch checked={config.autoSubtitles} onChange={(v) => set({ autoSubtitles: v })} label="Automatic subtitles" />
        </div>
      </Card>

      <Card>
        <CardHeader icon={Ban} title="Not available with this engine" sub="Shown for transparency — these toggles would do nothing, so they are disabled" />
        <div className="stack">
          {NOT_EXPOSED.map((item) => (
            <div key={item.label} className="between">
              <span className="small">{item.label}</span>
              <span className="small muted">{item.why}</span>
            </div>
          ))}
        </div>
      </Card>

      {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}

      <button type="button" className="btn primary block" onClick={start} disabled={busy || !backend.configured}>
        {busy ? <Spinner size={16} /> : <Sparkles size={16} />}
        {busy ? 'Processing…' : `Start AI clipping · ${effectiveCount || 0} × ${effectiveDuration || 0}s`}
      </button>
      {!backend.configured ? <div className="hint" style={{ textAlign: 'center' }}>Connect the processing backend first — processing cannot be simulated.</div> : null}
    </div>
  );
}
