import React, { useMemo, useState } from 'react';
import { CalendarDays, Send, Clock, AlertTriangle, RefreshCw, Trash2, CheckCircle2, Hash } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Card, CardHeader, Field, ChipGroup, Badge, Banner, Empty, Spinner, Modal } from '../ui';
import { PLATFORMS, platformLabel, timeAgo, formatSeconds } from '../lib/utils';

const STATUS_TONE = { published: 'ok', scheduled: 'info', publishing: 'info', failed: 'err', ready: 'info', draft: '' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Calendar({ go }) {
  const { projects, accounts, posts, integrations, refresh, toast } = useApp();
  const publishable = useMemo(() => projects.filter((p) => (p.clips || []).length), [projects]);
  const connected = accounts.filter((a) => a.status === 'connected');

  const [projectId, setProjectId] = useState(publishable[0]?.id || '');
  const [clipIndex, setClipIndex] = useState(0);
  const [platforms, setPlatforms] = useState(connected.map((a) => a.platform));
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [log, setLog] = useState('');

  const project = projects.find((p) => p.id === projectId) || publishable[0] || null;
  const clip = project?.clips?.[clipIndex];

  const togglePlatform = (id) => {
    setPlatforms((list) => (list.includes(id) ? list.filter((p) => p !== id) : [...list, id]));
  };

  const review = () => {
    setError('');
    if (!project || !clip) return setError('Choose a project and clip first.');
    if (!platforms.length) return setError('Select at least one connected account.');
    if (!connected.length) return setError('Connect a social account before publishing.');
    if (when && new Date(when).getTime() < Date.now()) return setError('The scheduled time is in the past.');
    setConfirming(true);
  };

  const submit = async () => {
    setBusy('publish');
    setError('');
    setLog('');
    setConfirming(false);
    const description = [caption.trim(), hashtags.trim()].filter(Boolean).join('\n\n');
    const scheduledIso = when ? new Date(when).toISOString() : null;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    let postId = '';
    try {
      const created = await api.createPost({
        projectId: project.id,
        projectTitle: project.title,
        jobId: project.jobId,
        clipIndex,
        clipTitle: clip.title || `Clip ${clipIndex + 1}`,
        platforms,
        title: clip.title || '',
        description,
        scheduledFor: scheduledIso,
        status: scheduledIso ? 'scheduled' : 'publishing',
        error: '',
      });
      postId = created?.post?.id || '';
      await refresh();

      const res = await api.publish({
        job_id: project.jobId,
        clip_index: clipIndex,
        platforms,
        title: clip.title || '',
        description,
        scheduled_date: scheduledIso,
        timezone,
      });
      const requestId = res?.request_id || res?.requestId || res?.id || res?.post_id;

      if (scheduledIso) {
        await api.updatePost(postId, { status: 'scheduled', providerRequestId: requestId || '', error: '' });
        setLog('Scheduled with the publishing provider. It will post at the chosen time.');
        toast('ok', 'Post scheduled with the provider.');
      } else {
        // Immediate publish: only claim "published" when the provider says so.
        let state = 'publishing';
        let providerMessage = '';
        for (let attempt = 0; attempt < 6 && requestId; attempt += 1) {
          await sleep(3000);
          try {
            const st = await api.postStatus(requestId);
            const raw = JSON.stringify(st?.status ?? st?.state ?? st ?? '').toLowerCase();
            providerMessage = st?.message || st?.error || '';
            if (raw.includes('fail') || raw.includes('error') || raw.includes('reject')) {
              state = 'failed';
              break;
            }
            if (raw.includes('success') || raw.includes('publish') || raw.includes('complete')) {
              state = 'published';
              break;
            }
          } catch (pollErr) {
            providerMessage = pollErr.message;
          }
        }
        await api.updatePost(postId, {
          status: state,
          providerRequestId: requestId || '',
          error: state === 'failed' ? providerMessage || 'The provider rejected the post.' : '',
          providerMessage: providerMessage.slice(0, 400),
        });
        if (state === 'published') {
          setLog('The provider confirmed the post.');
          toast('ok', 'Published and confirmed by the provider.');
        } else if (state === 'failed') {
          setError(providerMessage || 'The provider reported a failure. The post is marked failed and can be retried.');
        } else {
          setLog(
            requestId
              ? 'Upload accepted by the provider; confirmation is still pending. The post stays in "publishing" until the provider confirms.'
              : 'The provider accepted the request but returned no tracking id, so confirmation cannot be verified yet.',
          );
        }
      }
      await refresh();
    } catch (err) {
      setError(err.message);
      if (postId) {
        await api.updatePost(postId, { status: 'failed', error: err.message.slice(0, 500) }).catch(() => {});
        await refresh().catch(() => {});
      }
    } finally {
      setBusy('');
    }
  };

  const retry = async (post) => {
    setBusy(post.id);
    setError('');
    try {
      const res = await api.publish({
        job_id: post.jobId,
        clip_index: post.clipIndex,
        platforms: post.platforms,
        title: post.title,
        description: post.description,
        scheduled_date: post.scheduledFor || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      const requestId = res?.request_id || res?.requestId || res?.id || res?.post_id;
      await api.updatePost(post.id, {
        status: post.scheduledFor ? 'scheduled' : 'publishing',
        providerRequestId: requestId || '',
        error: '',
        attempts: (post.attempts || 0) + 1,
      });
      await refresh();
      toast('ok', 'Retry submitted to the provider.');
    } catch (err) {
      await api.updatePost(post.id, { error: err.message.slice(0, 500), attempts: (post.attempts || 0) + 1 }).catch(() => {});
      await refresh().catch(() => {});
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const removePost = async (post) => {
    setBusy(post.id);
    try {
      await api.deletePost(post.id);
      await refresh();
      toast('ok', 'Publishing record removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const grouped = useMemo(() => {
    const map = new Map();
    posts.forEach((p) => {
      const key = p.scheduledFor ? new Date(p.scheduledFor).toDateString() : 'No date';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
    return [...map.entries()].sort((a, b) => (a[0] === 'No date' ? 1 : b[0] === 'No date' ? -1 : new Date(a[0]) - new Date(b[0])));
  }, [posts]);

  return (
    <div className="stack">
      <Card>
        <CardHeader
          icon={Send}
          title="Publishing centre"
          sub="Every post is sent to the provider; status only changes on provider feedback"
          action={<Badge tone={integrations.uploadPostKey ? 'ok' : 'warn'}>{integrations.uploadPostKey ? 'provider ready' : 'setup required'}</Badge>}
        />
        {!integrations.uploadPostKey ? (
          <Banner tone="warn" icon={AlertTriangle}>
            <strong>SETUP REQUIRED.</strong> Publishing needs an Upload-Post API key in Settings → API providers.
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn sm primary" onClick={() => go('settings')}>Open settings</button>
            </div>
          </Banner>
        ) : null}

        {!publishable.length ? (
          <Empty icon={CalendarDays} title="No clips to publish" sub="Generate clips in a project first." />
        ) : (
          <>
            <div className="g2" style={{ marginTop: 12 }}>
              <Field label="Project">
                <select
                  className="select"
                  value={project?.id || ''}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setClipIndex(0);
                  }}
                >
                  {publishable.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Scheduled time" hint="Leave empty to publish immediately.">
                <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
            </div>

            <Field label="Clip">
              <div className="scroll-x">
                <ChipGroup
                  options={(project?.clips || []).map((c, i) => ({ value: i, label: `#${i + 1} · ${formatSeconds(c.duration)}` }))}
                  value={clipIndex}
                  onChange={setClipIndex}
                />
              </div>
            </Field>

            <Field label="Accounts" hint={connected.length ? 'Only verified accounts are selectable.' : 'No verified accounts yet.'}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {PLATFORMS.map((p) => {
                  const isConnected = connected.some((a) => a.platform === p.id);
                  const active = platforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`chip ${active && isConnected ? 'active' : ''}`}
                      onClick={() => (isConnected ? togglePlatform(p.id) : go('social'))}
                      title={isConnected ? p.label : `${p.label}: connect first`}
                      style={{ opacity: isConnected ? 1 : 0.55 }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Caption">
              <textarea className="textarea" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption sent with the clip" />
            </Field>
            <Field label="Hashtags">
              <input className="input" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#openclips #shorts" />
            </Field>

            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn primary sm" onClick={review} disabled={!!busy}>
                {busy === 'publish' ? <Spinner size={14} /> : <Send size={14} />} {when ? 'Schedule post' : 'Publish now'}
              </button>
              {clip?.videoUrl ? (
                <a className="btn sm ghost" href={clip.videoUrl} target="_blank" rel="noreferrer">Open clip</a>
              ) : null}
            </div>
          </>
        )}

        {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}
        {log ? <Banner tone="info" icon={CheckCircle2}>{log}</Banner> : null}
      </Card>

      <Card>
        <CardHeader icon={Clock} title="Publishing calendar" sub={`${posts.length} records`} />
        {!posts.length ? (
          <Empty icon={CalendarDays} title="Nothing scheduled" sub="Publish or schedule a clip to see it here." />
        ) : (
          <div className="stack">
            {grouped.map(([day, items]) => (
              <div key={day}>
                <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{day}</div>
                <div className="stack">
                  {items.map((p) => (
                    <div key={p.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {p.clipTitle || p.title || 'Clip'} <span className="small muted">· {p.projectTitle}</span>
                        </div>
                        <div className="small muted">
                          {p.platforms?.map(platformLabel).join(', ')} · {p.scheduledFor ? new Date(p.scheduledFor).toLocaleString() : timeAgo(p.createdAt)}
                        </div>
                        {p.error ? <div className="small" style={{ color: 'var(--danger, #f87171)' }}>{p.error}</div> : null}
                        {p.providerMessage && !p.error ? <div className="small muted">{p.providerMessage}</div> : null}
                      </div>
                      <Badge tone={STATUS_TONE[p.status] || ''}>{p.status}</Badge>
                      <div className="row" style={{ gap: 6 }}>
                        {p.status === 'failed' ? (
                          <button type="button" className="btn sm ghost" onClick={() => retry(p)} disabled={busy === p.id}>
                            <RefreshCw size={13} /> Retry
                          </button>
                        ) : null}
                        <button type="button" className="btn sm ghost" onClick={() => removePost(p)} disabled={busy === p.id} aria-label="Delete record">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={when ? 'Confirm schedule' : 'Confirm publish'}
        footer={
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn primary sm" onClick={submit} disabled={busy === 'publish'}>
              {busy === 'publish' ? <Spinner size={14} /> : <Send size={14} />} {when ? 'Schedule' : 'Publish'}
            </button>
          </div>
        }
      >
        <p className="small">
          Clip #{clipIndex + 1} of “{project?.title}” will be sent to {platforms.map(platformLabel).join(', ')}
          {when ? ` at ${new Date(when).toLocaleString()}` : ' immediately'}. This action contacts the real publishing
          provider.
        </p>
        {hashtags ? <div className="small muted"><Hash size={12} /> {hashtags}</div> : null}
      </Modal>
    </div>
  );
}
