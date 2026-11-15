import React, { useEffect, useState } from 'react';
import { Sparkles, Film, CalendarDays, Share2, BarChart3, Activity, ArrowUpRight, Server, KeyRound, FolderOpen, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Card, CardHeader, Stat, Badge, Empty, Banner, Spinner } from '../ui';
import { timeAgo } from '../lib/utils';

const statusTone = { complete: 'ok', processing: 'info', failed: 'err', draft: '' };

export default function Dashboard({ go }) {
  const { projects, posts, accounts, backend, integrations, engine } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .analytics()
      .then((res) => alive && setData(res))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [projects.length, posts.length, accounts.length]);

  const totals = data?.totals || {};
  const recent = projects.slice(0, 4);

  return (
    <div className="stack">
      {!backend.configured ? (
        <Banner tone="warn" icon={Server}>
          <strong>BACKEND NOT CONFIGURED.</strong> The clipping engine runs on the OpenShorts Python service (FFmpeg,
          faster-whisper, Gemini). Point this app at it in Settings → Processing backend, then import a video.
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn sm primary" onClick={() => go('settings')}>
              Open settings
            </button>
          </div>
        </Banner>
      ) : null}

      <div className="grid-4">
        <Stat label="Videos processed" value={totals.videosProcessed ?? 0} foot={`${projects.length} project${projects.length === 1 ? '' : 's'} saved`} />
        <Stat label="Clips generated" value={totals.clipsGenerated ?? 0} foot="Rendered by the engine" />
        <Stat label="Clips published" value={totals.clipsPublished ?? 0} foot={totals.scheduledPosts ? `${totals.scheduledPosts} scheduled` : 'Nothing scheduled'} />
        <Stat
          label="Publish success"
          value={totals.publishSuccessRate === null || totals.publishSuccessRate === undefined ? '—' : `${totals.publishSuccessRate}%`}
          foot={totals.publishSuccessRate === null ? 'No attempts yet' : `${totals.failedPosts || 0} failed`}
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader icon={Sparkles} title="Start here" sub="Import, clip, publish" />
          <div className="stack-sm">
            <button type="button" className="row-btn" onClick={() => go('new')}>
              <Plus size={16} /> New clipping project <ArrowUpRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
            <button type="button" className="row-btn" onClick={() => go('clips')}>
              <Film size={16} /> Browse my clips <ArrowUpRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
            <button type="button" className="row-btn" onClick={() => go('campaigns')}>
              <BarChart3 size={16} /> Research a campaign <ArrowUpRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
            <button type="button" className="row-btn" onClick={() => go('calendar')}>
              <CalendarDays size={16} /> Publishing calendar <ArrowUpRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Server} title="Connections" sub="Live status, not assumptions" />
          <div className="stack-sm">
            <div className="between">
              <span className="small muted">Processing backend</span>
              <Badge tone={engine.status === 'online' ? 'ok' : backend.configured ? 'warn' : 'err'}>
                {engine.status === 'online' ? 'Reachable' : backend.configured ? 'Unreachable' : 'Not configured'}
              </Badge>
            </div>
            <div className="between">
              <span className="small muted">Gemini key (clip detection)</span>
              <Badge tone={integrations.geminiKey ? 'ok' : 'warn'}>{integrations.geminiKey ? 'Saved' : 'Not set'}</Badge>
            </div>
            <div className="between">
              <span className="small muted">Upload-Post key (publishing)</span>
              <Badge tone={integrations.uploadPostKey ? 'ok' : 'warn'}>{integrations.uploadPostKey ? 'Saved' : 'Not set'}</Badge>
            </div>
            <div className="between">
              <span className="small muted">Social accounts</span>
              <Badge tone={accounts.length ? 'ok' : ''}>{accounts.length ? `${accounts.length} connected` : 'None connected'}</Badge>
            </div>
            <button type="button" className="btn sm block" onClick={() => go('settings')}>
              <KeyRound size={14} /> Manage credentials
            </button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          icon={FolderOpen}
          title="Recent projects"
          sub="Saved on the server — survives a refresh"
          action={
            <button type="button" className="btn sm" onClick={() => go('clips')}>
              All projects
            </button>
          }
        />
        {error ? <Banner tone="err">{error}</Banner> : null}
        {!recent.length ? (
          <Empty
            icon={Film}
            title="No projects yet"
            sub="Import a link or upload a video to run the first AI clipping pass."
            action={
              <button type="button" className="btn primary sm" onClick={() => go('new')}>
                <Plus size={14} /> New project
              </button>
            }
          />
        ) : (
          <div className="stack-sm">
            {recent.map((p) => (
              <div key={p.id} className="row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                  <div className="small muted">
                    {Array.isArray(p.clips) ? p.clips.length : 0} clips · {timeAgo(p.updatedAt)}
                  </div>
                </div>
                <Badge tone={statusTone[p.status] || ''}>{p.status}</Badge>
                <button type="button" className="btn sm" onClick={() => go('clips')}>
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader icon={Share2} title="Publishing queue" sub="Provider-confirmed states only" action={<button type="button" className="btn sm" onClick={() => go('calendar')}>Calendar</button>} />
        {!posts.length ? (
          <Empty icon={CalendarDays} title="Nothing queued" sub="Publish or schedule a clip from the calendar to see it here." />
        ) : (
          <div className="stack-sm">
            {posts.slice(0, 5).map((post) => (
              <div key={post.id} className="row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {post.clipTitle || 'Clip'}
                  </div>
                  <div className="small muted">
                    {(post.platforms || []).join(', ') || 'no platform'} · {post.scheduledFor ? new Date(post.scheduledFor).toLocaleString() : 'not scheduled'}
                  </div>
                </div>
                <Badge tone={post.status === 'published' ? 'ok' : post.status === 'failed' ? 'err' : post.status === 'scheduled' ? 'info' : ''}>{post.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {!data && !error ? (
        <div className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Spinner size={14} /> Loading analytics…
        </div>
      ) : null}
      {data?.engagement ? <Activity size={14} style={{ display: 'none' }} /> : null}
    </div>
  );
}
