import React, { useEffect, useMemo, useState } from 'react';
import { Clapperboard, Download, ListTree, FileText, Layers, AlertTriangle, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Card, CardHeader, Badge, Banner, Empty, Spinner, ChipGroup } from '../ui';
import { formatClock, formatSeconds } from '../lib/utils';
import ClipEditor from '../components/ClipEditor';

/**
 * AI Video Studio: per-clip advanced workspace plus the engine's own scene,
 * EDL and transcript data. Everything here reads or writes the real engine.
 */
export default function Studio({ go }) {
  const { projects, refresh, toast } = useApp();
  const ready = useMemo(() => projects.filter((p) => (p.clips || []).length), [projects]);
  const [projectId, setProjectId] = useState(ready[0]?.id || '');
  const [clipIndex, setClipIndex] = useState(0);
  const [edl, setEdl] = useState(null);
  const [scenes, setScenes] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const project = projects.find((p) => p.id === projectId) || ready[0] || null;

  useEffect(() => {
    if (!projectId && ready[0]) setProjectId(ready[0].id);
  }, [ready, projectId]);

  useEffect(() => {
    setEdl(null);
    setScenes(null);
    setTranscript(null);
    setError('');
  }, [projectId, clipIndex]);

  if (!ready.length) {
    return (
      <Empty
        icon={Clapperboard}
        title="No rendered clips yet"
        sub="The studio edits clips the engine has already produced. Run a project first."
        action={<button type="button" className="btn primary sm" onClick={() => go('new')}>New project</button>}
      />
    );
  }

  const load = async (kind, fn) => {
    setBusy(kind);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const loadEdl = () =>
    load('edl', async () => {
      const res = await api.clipEdl(project.jobId, clipIndex);
      setEdl(res);
    });

  const loadScenes = () =>
    load('scenes', async () => {
      const res = await api.clipScenes(project.jobId, clipIndex);
      setScenes(res);
    });

  const loadTranscript = () =>
    load('transcript', async () => {
      const res = await api.clipTranscript(project.jobId, clipIndex);
      setTranscript(res?.transcript || res?.text || res);
    });

  const clip = project.clips?.[clipIndex];

  return (
    <div className="stack">
      <Card>
        <CardHeader icon={Clapperboard} title="AI video studio" sub="Advanced per-clip work against the processing engine" />
        <div className="g2">
          <label className="field">
            <span className="label">Project</span>
            <select
              className="select"
              value={project.id}
              onChange={(e) => {
                setProjectId(e.target.value);
                setClipIndex(0);
              }}
            >
              {ready.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.clips.length})
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="label">Download</span>
            {project.jobId ? (
              <a className="btn sm" href={api.downloadAllUrl(project.jobId)}>
                <Download size={14} /> All clips as ZIP
              </a>
            ) : (
              <span className="small muted">No engine job id stored</span>
            )}
          </div>
        </div>
        <div className="scroll-x" style={{ marginTop: 10 }}>
          <ChipGroup
            options={(project.clips || []).map((c, i) => ({ value: i, label: `#${i + 1} · ${formatSeconds(c.duration)}` }))}
            value={clipIndex}
            onChange={setClipIndex}
          />
        </div>
      </Card>

      {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}

      <div className="g2">
        <div>
          <ClipEditor project={project} clipIndex={clipIndex} onSaved={() => refresh().catch(() => {})} toast={toast} />
        </div>
        <div className="stack">
          <Card>
            <CardHeader icon={Layers} title="Engine data" sub="Raw timeline information for this clip" />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm" onClick={loadEdl} disabled={!!busy}>
                {busy === 'edl' ? <Spinner size={14} /> : <ListTree size={14} />} EDL
              </button>
              <button type="button" className="btn sm" onClick={loadScenes} disabled={!!busy}>
                {busy === 'scenes' ? <Spinner size={14} /> : <Sparkles size={14} />} Scenes
              </button>
              <button type="button" className="btn sm" onClick={loadTranscript} disabled={!!busy}>
                {busy === 'transcript' ? <Spinner size={14} /> : <FileText size={14} />} Transcript
              </button>
            </div>

            {edl ? (
              <div className="logs" style={{ marginTop: 12 }}>
                {(Array.isArray(edl?.segments) ? edl.segments : Array.isArray(edl?.edl) ? edl.edl : []).map((seg, i) => (
                  <div key={i}>
                    {formatClock(seg.start)} → {formatClock(seg.end)} ({formatSeconds((seg.end || 0) - (seg.start || 0))})
                  </div>
                ))}
                {!Array.isArray(edl?.segments) && !Array.isArray(edl?.edl) ? <div className="small muted">Engine returned no segment list.</div> : null}
              </div>
            ) : null}

            {scenes ? (
              <div className="logs" style={{ marginTop: 12 }}>
                {(Array.isArray(scenes?.scenes) ? scenes.scenes : []).slice(0, 24).map((s, i) => (
                  <div key={i}>
                    scene {s.index ?? i}: {formatClock(s.start)} → {formatClock(s.end)}
                    {s.kind || s.layout ? ` · ${s.kind || s.layout}` : ''}
                  </div>
                ))}
                {!Array.isArray(scenes?.scenes) ? <div className="small muted">Engine returned no scene list.</div> : null}
              </div>
            ) : null}

            {transcript ? (
              <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 12, lineHeight: 1.6 }}>
                {typeof transcript === 'string' ? transcript : JSON.stringify(transcript, null, 2).slice(0, 4000)}
              </p>
            ) : null}
          </Card>

          {clip ? (
            <Card>
              <CardHeader icon={Sparkles} title="AI reasoning" sub="Scores are estimates, not virality guarantees" />
              <div className="between" style={{ marginBottom: 8 }}>
                <span className="small muted">Potential score</span>
                <Badge tone="info">{clip.score !== null && clip.score !== undefined ? clip.score : 'not returned'}</Badge>
              </div>
              <p className="small muted" style={{ lineHeight: 1.6 }}>
                {clip.reason || 'The engine did not return a selection reason for this clip.'}
              </p>
              <div className="small muted" style={{ marginTop: 8 }}>
                Source window {formatClock(clip.start)} → {formatClock(clip.end)}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
