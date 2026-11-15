import React, { useEffect, useState } from 'react';
import { BarChart3, Activity, AlertTriangle, RefreshCw, Link2, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Card, CardHeader, Stat, Badge, Banner, Empty, Spinner } from '../ui';
import { platformLabel } from '../lib/utils';

/**
 * Analytics shows stored application data and, when the provider key exists,
 * the publishing provider's own metrics. Missing sources are labelled, never
 * filled with invented numbers.
 */
export default function Analytics({ go }) {
  const { projects, posts, accounts, integrations, refresh } = useApp();
  const [engine, setEngine] = useState(null);
  const [engineError, setEngineError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setEngineError('');
    try {
      const res = await api.socialAnalytics();
      setEngine(res);
    } catch (err) {
      setEngine(null);
      setEngineError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (integrations.uploadPostKey) load();
  }, [integrations.uploadPostKey]);

  const clips = projects.reduce((n, p) => n + (p.clips?.length || 0), 0);
  const published = posts.filter((p) => p.status === 'published');
  const failed = posts.filter((p) => p.status === 'failed');
  const scheduled = posts.filter((p) => p.status === 'scheduled');
  const attempted = published.length + failed.length;
  const successRate = attempted ? Math.round((published.length / attempted) * 100) : null;
  const connected = accounts.filter((a) => a.status === 'connected');

  const platformCounts = published.reduce((acc, p) => {
    (p.platforms || []).forEach((pl) => {
      acc[pl] = (acc[pl] || 0) + 1;
    });
    return acc;
  }, {});

  return (
    <div className="stack">
      <Card>
        <CardHeader
          icon={BarChart3}
          title="Analytics"
          sub="Application data stored by this server"
          action={
            <button type="button" className="btn sm ghost" onClick={() => refresh().catch(() => {})}>
              <RefreshCw size={13} /> Refresh
            </button>
          }
        />
        <div className="g4">
          <Stat label="Videos processed" value={projects.length} />
          <Stat label="Clips generated" value={clips} />
          <Stat label="Clips published" value={published.length} />
          <Stat label="Scheduled posts" value={scheduled.length} />
        </div>
        <div className="g4" style={{ marginTop: 12 }}>
          <Stat label="Publishing success rate" value={successRate === null ? '—' : `${successRate}%`} foot={attempted ? `${attempted} attempts` : 'no attempts yet'} />
          <Stat label="Failed posts" value={failed.length} />
          <Stat label="Connected accounts" value={connected.length} />
          <Stat label="Campaigns" value={useApp().campaigns.length} />
        </div>
      </Card>

      <div className="g2">
        <Card>
          <CardHeader icon={CheckCircle2} title="Published per platform" sub="Counted from confirmed posts" />
          {!published.length ? (
            <Empty icon={BarChart3} title="No confirmed posts yet" sub="Publish a clip to start collecting counts." />
          ) : (
            <div className="stack">
              {Object.entries(platformCounts).map(([pl, n]) => (
                <div key={pl}>
                  <div className="between small">
                    <span>{platformLabel(pl)}</span>
                    <span className="muted">{n}</span>
                  </div>
                  <div className="progress">
                    <span style={{ width: `${Math.min(100, (n / published.length) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader icon={Activity} title="Platform engagement" sub="From the publishing provider" />
          {!integrations.uploadPostKey ? (
            <Banner tone="warn" icon={AlertTriangle}>
              <strong>DATA SOURCE NOT CONNECTED.</strong> Views, likes and follower counts are only available from the
              publishing provider. Add an Upload-Post key in Settings to read them.
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn sm primary" onClick={() => go('settings')}>Open settings</button>
              </div>
            </Banner>
          ) : busy ? (
            <Spinner />
          ) : engineError ? (
            <Banner tone="err" icon={AlertTriangle}>{engineError}</Banner>
          ) : engine ? (
            <div className="stack">
              <Badge tone="info">provider response</Badge>
              <pre className="logs small" style={{ maxHeight: 260, overflow: 'auto' }}>
                {JSON.stringify(engine, null, 2).slice(0, 4000)}
              </pre>
              <div className="small muted">
                Raw provider metrics are shown as returned. This app does not derive views, likes or revenue of its own.
              </div>
            </div>
          ) : (
            <Empty icon={Link2} title="No metrics returned" sub="The provider answered without analytics data." />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader icon={Link2} title="Sources" sub="What each number above is based on" />
        <div className="small muted" style={{ lineHeight: 1.8 }}>
          Videos processed and clips generated: project records stored by this server after a successful engine job.
          <br />
          Published / scheduled / failed: publishing records updated only from provider responses.
          <br />
          Connected accounts: accounts verified with the publishing provider.
          <br />
          Platform engagement: not stored locally; requires the provider analytics endpoint.
        </div>
      </Card>
    </div>
  );
}
