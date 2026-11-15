import React, { useMemo, useState } from 'react';
import { Search, Film, Pencil, Trash2, Download, FolderOpen, Play, X, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Card, CardHeader, Badge, Banner, Empty, Modal, Spinner, ChipGroup, Field } from '../ui';
import { timeAgo, formatSeconds, formatClock } from '../lib/utils';
import ClipEditor from '../components/ClipEditor';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'complete', label: 'Ready' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
];

export default function MyClips({ go }) {
  const { projects, refresh, toast } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // { projectId, index }
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (!q) return true;
      if ((p.title || '').toLowerCase().includes(q)) return true;
      return (p.clips || []).some((c) => (c.title || '').toLowerCase().includes(q));
    });
  }, [projects, query, filter]);

  const activeProject = editing ? projects.find((p) => p.id === editing.projectId) : null;

  const saveRename = async () => {
    if (!renaming) return;
    const title = renameValue.trim();
    if (!title) {
      setError('A project needs a name.');
      return;
    }
    setBusy('rename');
    setError('');
    try {
      await api.updateProject(renaming.id, { title });
      await refresh();
      toast('ok', 'Project renamed.');
      setRenaming(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy('delete');
    setError('');
    try {
      await api.deleteProject(deleting.id);
      await refresh();
      toast('ok', 'Project deleted.');
      setDeleting(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="stack">
      <Card>
        <CardHeader
          icon={FolderOpen}
          title="My clips"
          sub="Projects and rendered clips, stored on the server"
          action={
            <button type="button" className="btn primary sm" onClick={() => go('new')}>
              <Film size={14} /> New project
            </button>
          }
        />
        <Field label="Search projects and clips">
          <div className="row" style={{ gap: 8 }}>
            <Search size={16} className="muted" />
            <input className="input" placeholder="Search by title or clip name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </Field>
        <div style={{ marginTop: 10 }}>
          <ChipGroup options={FILTERS} value={filter} onChange={setFilter} />
        </div>
      </Card>

      {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}

      {!filtered.length ? (
        <Empty
          icon={Film}
          title={projects.length ? 'Nothing matches that search' : 'No projects yet'}
          sub={projects.length ? 'Try a different search or filter.' : 'Import a link or upload a video to generate clips.'}
          action={
            <button type="button" className="btn primary sm" onClick={() => go('new')}>
              New project
            </button>
          }
        />
      ) : (
        filtered.map((project) => (
          <Card key={project.id}>
            <div className="between" style={{ marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</div>
                <div className="card-sub">
                  {(project.clips || []).length} clips · {timeAgo(project.updatedAt)}
                  {project.jobId ? ` · job ${String(project.jobId).slice(0, 10)}` : ''}
                  {project.source?.type === 'url' && project.source?.url ? ` · ${project.source.url.slice(0, 48)}` : ''}
                </div>
              </div>
              <Badge tone={project.status === 'complete' ? 'ok' : project.status === 'failed' ? 'err' : project.status === 'processing' ? 'info' : ''}>
                {project.status}
              </Badge>
            </div>

            {project.status === 'failed' && project.error ? <Banner tone="err" icon={AlertTriangle}>{project.error}</Banner> : null}
            {project.status === 'processing' ? (
              <Banner tone="info">
                This project is still processing on the backend. Progress is shown on the New Project page.
              </Banner>
            ) : null}

            {(project.clips || []).length ? (
              <div className="clip-grid">
                {project.clips.map((clip, index) => (
                  <div key={`${project.id}-${index}`} className="clip-card">
                    <div className="clip-thumb">
                      {clip.thumbnail ? (
                        <img src={clip.thumbnail} alt="" loading="lazy" />
                      ) : clip.videoUrl ? (
                        <video src={`${clip.videoUrl}#t=0.5`} muted playsInline preload="metadata" />
                      ) : (
                        <div className="small muted" style={{ padding: 16 }}>No preview</div>
                      )}
                      <span className="clip-tags">
                        <Badge tone="info">#{index + 1}</Badge>
                        {clip.score !== null && clip.score !== undefined ? <Badge>score {clip.score}</Badge> : null}
                      </span>
                    </div>
                    <div className="clip-title">{clip.title || `Clip ${index + 1}`}</div>
                    <div className="clip-meta">
                      {formatClock(clip.start)} → {formatClock(clip.end)} · {formatSeconds(clip.duration)}
                    </div>
                    {clip.hook ? <div className="small muted" style={{ marginTop: 4 }}>“{clip.hook}”</div> : null}
                    <div className="clip-actions">
                      <button type="button" className="btn sm" onClick={() => setEditing({ projectId: project.id, index })}>
                        <Play size={13} /> Edit & preview
                      </button>
                      {clip.videoUrl ? (
                        <a className="btn sm ghost" href={clip.videoUrl} download={`${(clip.title || 'clip').replace(/[^\w-]+/g, '-')}.mp4`}>
                          <Download size={13} /> Download
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : project.status === 'complete' ? (
              <div className="small muted">The engine finished without returning clips for this project.</div>
            ) : null}

            <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
              {project.jobId ? (
                <a className="btn sm ghost" href={api.downloadAllUrl(project.jobId)}>
                  <Download size={13} /> Download all
                </a>
              ) : null}
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  setRenaming(project);
                  setRenameValue(project.title || '');
                }}
              >
                <Pencil size={13} /> Rename
              </button>
              <button type="button" className="btn sm ghost" onClick={() => setDeleting(project)}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </Card>
        ))
      )}

      <Modal open={!!activeProject} onClose={() => setEditing(null)} title="Clip editor" wide>
        {activeProject ? (
          <ClipEditor
            project={activeProject}
            clipIndex={editing.index}
            onSaved={() => refresh().catch(() => {})}
            toast={toast}
          />
        ) : null}
      </Modal>

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename project"
        footer={
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost sm" onClick={() => setRenaming(null)}>Cancel</button>
            <button type="button" className="btn primary sm" onClick={saveRename} disabled={busy === 'rename'}>
              {busy === 'rename' ? <Spinner size={14} /> : null} Save name
            </button>
          </div>
        }
      >
        <Field label="Project name">
          <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
        </Field>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete project?"
        footer={
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost sm" onClick={() => setDeleting(null)}>Keep it</button>
            <button type="button" className="btn danger sm" onClick={confirmDelete} disabled={busy === 'delete'}>
              {busy === 'delete' ? <Spinner size={14} /> : <Trash2 size={14} />} Delete project
            </button>
          </div>
        }
      >
        <p className="small">
          “{deleting?.title}” and its clip records will be removed from this app. Files already rendered stay on the
          processing backend until you clean that job up there.
        </p>
      </Modal>
    </div>
  );
}
