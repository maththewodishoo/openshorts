import React, { useEffect, useMemo, useState } from 'react';
import { Play, Pause, Download, Trash2, Scissors, Wand2, Captions, Type, Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Banner, Card, ChipGroup, Field, Spinner } from '../ui';
import { formatClock, formatSeconds } from '../lib/utils';

export const CAPTION_PRESETS = [
  { value: 'karaoke', label: 'Karaoke', preset: 'hormozi' },
  { value: 'bold', label: 'Bold', preset: 'default' },
  { value: 'minimal', label: 'Minimal', preset: 'clean' },
  { value: 'neon', label: 'Neon', preset: 'lime' },
  { value: 'professional', label: 'Professional', preset: 'pill' },
];
export const presetFor = (style) => CAPTION_PRESETS.find((c) => c.value === style)?.preset || 'default';

const FRAMINGS = [
  { value: 'track', label: 'Face tracking' },
  { value: 'general', label: 'Centre crop' },
  { value: 'none', label: 'Full frame' },
];

/**
 * Editor for one rendered clip. Every control calls a real engine endpoint and
 * persists the result to the project record, so a refresh keeps the edit.
 */
export default function ClipEditor({ project, clipIndex, onSaved, toast }) {
  const clip = project.clips?.[clipIndex];
  const [title, setTitle] = useState(clip?.title || '');
  const [hook, setHook] = useState(clip?.hook || '');
  const [caption, setCaption] = useState(clip?.caption || '');
  const [start, setStart] = useState(clip?.start ?? 0);
  const [end, setEnd] = useState(clip?.end ?? 0);
  const [captionStyle, setCaptionStyle] = useState(clip?.captionStyle || 'bold');
  const [framing, setFraming] = useState('track');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [transcript, setTranscript] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setTitle(clip?.title || '');
    setHook(clip?.hook || '');
    setCaption(clip?.caption || '');
    setStart(clip?.start ?? 0);
    setEnd(clip?.end ?? 0);
    setCaptionStyle(clip?.captionStyle || 'bold');
    setError('');
    setNote('');
    setTranscript(null);
    setPlaying(false);
  }, [project.id, clipIndex, clip?.title, clip?.start, clip?.end]);

  const clips = useMemo(() => project.clips || [], [project.clips]);

  const patchClips = async (patch, message) => {
    const next = clips.map((c, i) => (i === clipIndex ? { ...c, ...patch } : c));
    const res = await api.updateProject(project.id, { clips: next });
    onSaved?.(res.project?.clips || next);
    if (message) toast?.('ok', message);
  };

  const run = async (kind, fn, successMessage) => {
    setBusy(kind);
    setError('');
    setNote('');
    try {
      await fn();
      if (successMessage) toast?.('ok', successMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  if (!clip) return <Banner tone="warn">This clip is no longer part of the project.</Banner>;

  const saveMeta = () =>
    run('save', () => patchClips({ title, hook, caption }, 'Clip details saved.'), null);

  const applyTrim = () =>
    run(
      'trim',
      async () => {
        if (!project.jobId) throw new Error('This project has no engine job id, so it cannot be re-cut.');
        if (!(end > start)) throw new Error('The end time must be after the start time.');
        const res = await api.rerenderClip({
          jobId: project.jobId,
          clipIndex,
          segments: [{ start: Number(start), end: Number(end) }],
        });
        const url = res?.video_url || res?.clip?.video_url || res?.url || clip.videoUrl;
        await patchClips({ start: Number(start), end: Number(end), duration: Number(end) - Number(start), videoUrl: url });
        setNote(`Re-cut on the engine${res?.video_url ? ' and the new file is attached' : ''}.`);
      },
      'Clip boundaries re-rendered.',
    );

  const applyCaptions = () =>
    run(
      'captions',
      async () => {
        if (!project.jobId) throw new Error('This project has no engine job id.');
        const res = await api.restyleSubtitles({ jobId: project.jobId, clipIndex, preset: presetFor(captionStyle) });
        const url = res?.video_url || res?.clip?.video_url || res?.url;
        await patchClips({ captionStyle, ...(url ? { videoUrl: url } : {}) });
        setNote(`Caption preset “${presetFor(captionStyle)}” burned in.`);
      },
      'Captions restyled on the engine.',
    );

  const applyFraming = () =>
    run(
      'framing',
      async () => {
        if (!project.jobId) throw new Error('This project has no engine job id.');
        const res = await api.reframeClip({ jobId: project.jobId, clipIndex, framing });
        const url = res?.video_url || res?.clip?.video_url || res?.url;
        await patchClips({ framing, ...(url ? { videoUrl: url } : {}) });
        setNote(`Framing set to ${framing}.`);
      },
      'Framing applied.',
    );

  const makeHook = () =>
    run(
      'hook',
      async () => {
        const res = await api.generateHook({ job_id: project.jobId, clip_index: clipIndex });
        const nextHook = res?.hook || res?.text || res?.title;
        if (!nextHook) throw new Error('The engine did not return a hook. Check that an AI provider key is configured.');
        setHook(nextHook);
        await patchClips({ hook: nextHook });
      },
      'Hook generated by the engine.',
    );

  const loadTranscript = () =>
    run('transcript', async () => {
      const res = await api.clipTranscript(project.jobId, clipIndex);
      const text = res?.transcript || res?.text || res?.words?.map?.((w) => w.word || w.text).join(' ') || '';
      if (!text) throw new Error('The engine has no transcript stored for this clip.');
      setTranscript(text);
    });

  const deleteClip = () =>
    run('delete', async () => {
      const next = clips.filter((_, i) => i !== clipIndex);
      await api.updateProject(project.id, { clips: next });
      onSaved?.(next);
      toast?.('warn', 'Clip removed from your library. The rendered file stays on the engine until its job is cleaned up.');
    });

  return (
    <div className="stack">
      <div className="clip-thumb" style={{ position: 'relative', background: '#0b1020' }}>
        {clip.videoUrl ? (
          <video
            src={clip.videoUrl}
            poster={clip.thumbnail || undefined}
            controls
            playsInline
            preload="metadata"
            style={{ width: '100%', maxHeight: 420, display: 'block', borderRadius: 14 }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <div className="small muted" style={{ padding: 24 }}>
            The engine did not return a playable file for this clip.
          </div>
        )}
      </div>

      <div className="between">
        <div className="small muted">
          {formatClock(start)} → {formatClock(end)} · {formatSeconds(clip.duration)} ·{' '}
          {clip.score !== null && clip.score !== undefined ? `AI score ${clip.score} (estimate)` : 'no score'}
        </div>
        <Badge tone={playing ? 'ok' : ''}>{playing ? 'playing' : 'preview'}</Badge>
      </div>

      {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}
      {note ? <Banner tone="ok">{note}</Banner> : null}

      <div className="g2">
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Hook" hint="Opening line burned into the clip by the engine">
          <input className="input" value={hook} onChange={(e) => setHook(e.target.value)} />
        </Field>
      </div>
      <Field label="Caption / description">
        <textarea className="textarea" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption used when publishing this clip" />
      </Field>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary sm" onClick={saveMeta} disabled={!!busy}>
          {busy === 'save' ? <Spinner size={14} /> : <Save size={14} />} Save details
        </button>
        <button type="button" className="btn sm" onClick={makeHook} disabled={!!busy}>
          {busy === 'hook' ? <Spinner size={14} /> : <Wand2 size={14} />} Generate hook
        </button>
        <button type="button" className="btn sm" onClick={loadTranscript} disabled={!!busy}>
          {busy === 'transcript' ? <Spinner size={14} /> : <Type size={14} />} Transcript
        </button>
        {clip.videoUrl ? (
          <a className="btn sm" href={clip.videoUrl} download={`clip-${clipIndex + 1}.mp4`}>
            <Download size={14} /> Download
          </a>
        ) : null}
        <button type="button" className="btn sm danger" onClick={deleteClip} disabled={!!busy}>
          <Trash2 size={14} /> Delete clip
        </button>
      </div>

      <Card>
        <div className="card-title"><Scissors size={15} style={{ color: 'var(--cyan)' }} /> Clip boundaries</div>
        <div className="card-sub">Times are absolute positions in the source video, snapped to words by the engine.</div>
        <div className="g2" style={{ marginTop: 12 }}>
          <Field label="Start (seconds)">
            <input className="input" type="number" min="0" step="0.1" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End (seconds)">
            <input className="input" type="number" min="0" step="0.1" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <button type="button" className="btn sm" onClick={applyTrim} disabled={!!busy} style={{ marginTop: 10 }}>
          {busy === 'trim' ? <Spinner size={14} /> : <RefreshCw size={14} />} Re-render clip
        </button>
      </Card>

      <Card>
        <div className="card-title"><Captions size={15} style={{ color: 'var(--cyan)' }} /> Caption style</div>
        <div className="card-sub">Burns a different built-in preset over the clip with a fresh subtitle pass.</div>
        <div style={{ marginTop: 10 }}>
          <ChipGroup options={CAPTION_PRESETS} value={captionStyle} onChange={setCaptionStyle} />
        </div>
        <button type="button" className="btn sm" onClick={applyCaptions} disabled={!!busy} style={{ marginTop: 10 }}>
          {busy === 'captions' ? <Spinner size={14} /> : <Play size={14} />} Apply caption style
        </button>
      </Card>

      <Card>
        <div className="card-title"><Pause size={15} style={{ color: 'var(--cyan)' }} /> Camera framing</div>
        <div className="card-sub">Re-runs the reframe pass on the existing cut.</div>
        <div style={{ marginTop: 10 }}>
          <ChipGroup options={FRAMINGS} value={framing} onChange={setFraming} />
        </div>
        <button type="button" className="btn sm" onClick={applyFraming} disabled={!!busy} style={{ marginTop: 10 }}>
          {busy === 'framing' ? <Spinner size={14} /> : <RefreshCw size={14} />} Apply framing
        </button>
      </Card>

      {transcript ? (
        <Card>
          <div className="card-title">Transcript</div>
          <p className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{transcript}</p>
        </Card>
      ) : null}

      {clip.reason ? (
        <Card>
          <div className="card-title">Why the AI picked this</div>
          <p className="small muted" style={{ lineHeight: 1.6 }}>{clip.reason}</p>
        </Card>
      ) : null}
    </div>
  );
}
