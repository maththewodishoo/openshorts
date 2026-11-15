import React, { useState } from 'react';
import { Globe, Sparkles, Trash2, AlertTriangle, Wand2, Save, Megaphone, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, getDraft, setDraft } from '../lib/store';
import { Card, CardHeader, Field, Badge, Banner, Empty, Spinner, Modal, ChipGroup } from '../ui';
import { timeAgo } from '../lib/utils';

const EMPTY = { title: '', url: '', description: '', affiliate: '', audience: '' };

export default function Campaigns({ go }) {
  const { campaigns, integrations, refresh, toast, settings } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [brief, setBrief] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const research = async () => {
    setError('');
    setBrief(null);
    if (!form.url.trim() && !form.description.trim()) {
      setError('Add a product or campaign URL, or describe the product.');
      return;
    }
    if (!integrations.geminiKey) {
      setError('SETUP REQUIRED: add your Gemini API key in Settings → API providers. Research runs on your own key; nothing is generated without it.');
      return;
    }
    setBusy('research');
    try {
      const res = await api.research({
        url: form.url.trim(),
        description: form.description.trim(),
        title: form.title.trim(),
        audience: form.audience.trim(),
        affiliate: form.affiliate.trim(),
      });
      setBrief(res.brief);
      toast('ok', 'Campaign brief generated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const saveCampaign = async () => {
    setError('');
    if (!form.title.trim()) {
      setError('Give the campaign a name before saving.');
      return;
    }
    setBusy('save');
    try {
      await api.createCampaign({ ...form, brief: brief || null });
      await refresh();
      toast('ok', 'Campaign saved.');
      setForm(EMPTY);
      setBrief(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy('delete');
    try {
      await api.deleteCampaign(deleting.id);
      await refresh();
      toast('ok', 'Campaign deleted.');
      setDeleting(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const useInProject = (campaign) => {
    const hooks = campaign.brief?.hooks || [];
    setDraft({
      config: {
        ...(getDraft().config || {}),
        detectionStyle: 'custom',
        customInstructions: [
          `Promote ${campaign.title}.`,
          campaign.brief?.angles?.[0] ? `Angle: ${campaign.brief.angles[0]}` : '',
          hooks[0] ? `Preferred hook style: ${hooks[0]}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
    });
    go('new');
  };

  const BriefBlock = ({ label, items }) =>
    items && items.length ? (
      <div style={{ marginTop: 10 }}>
        <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
        <ul className="small" style={{ margin: '6px 0 0 18px', lineHeight: 1.6 }}>
          {items.map((it, i) => (
            <li key={i}>{typeof it === 'string' ? it : JSON.stringify(it)}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="stack">
      <Card>
        <CardHeader icon={Megaphone} title="Campaign research" sub="Turn a product or campaign into angles, hooks and a script" />
        {!integrations.geminiKey ? (
          <Banner tone="warn" icon={AlertTriangle}>
            <strong>SETUP REQUIRED.</strong> Research needs a Gemini API key (free tier available) saved in
            Settings → API providers. This app calls the model with your key server-side and never puts it in the browser.
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn sm primary" onClick={() => go('settings')}>Open settings</button>
            </div>
          </Banner>
        ) : null}
        <div className="g2" style={{ marginTop: 12 }}>
          <Field label="Campaign name">
            <input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Spring launch" />
          </Field>
          <Field label="Product / campaign URL" hint="Only publicly readable pages; sites that block bots will say so.">
            <input className="input" type="url" value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/product" />
          </Field>
        </div>
        <Field label="Product description">
          <textarea className="textarea" rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What it is, who it is for, the promise it makes" />
        </Field>
        <div className="g2">
          <Field label="Affiliate / offer details">
            <input className="input" value={form.affiliate} onChange={(e) => set({ affiliate: e.target.value })} placeholder="Commission, coupon, landing page" />
          </Field>
          <Field label="Target audience">
            <input className="input" value={form.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="e.g. freelance designers, 25-35" />
          </Field>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="btn primary sm" onClick={research} disabled={!!busy}>
            {busy === 'research' ? <Spinner size={14} /> : <Sparkles size={14} />} Research with AI
          </button>
          <button type="button" className="btn sm" onClick={saveCampaign} disabled={!!busy}>
            {busy === 'save' ? <Spinner size={14} /> : <Save size={14} />} Save campaign
          </button>
        </div>
        {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}
      </Card>

      {brief ? (
        <Card>
          <CardHeader icon={Wand2} title="Generated brief" sub="Written by your configured AI provider — review before use" />
          {brief.summary ? <p className="small" style={{ lineHeight: 1.65 }}>{brief.summary}</p> : null}
          <BriefBlock label="Product benefits" items={brief.benefits} />
          <BriefBlock label="Target audience" items={brief.audience} />
          <BriefBlock label="Marketing angles" items={brief.angles} />
          <BriefBlock label="Video hooks" items={brief.hooks} />
          <BriefBlock label="Calls to action" items={brief.ctas} />
          <BriefBlock label="Hashtags" items={brief.hashtags} />
          <BriefBlock label="Content ideas" items={brief.ideas} />
          {brief.script ? (
            <div style={{ marginTop: 12 }}>
              <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Promotional script</div>
              <pre className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6, lineHeight: 1.6 }}>{brief.script}</pre>
            </div>
          ) : null}
          {brief.sources?.length ? (
            <div className="small muted" style={{ marginTop: 10 }}>
              Sources read: {brief.sources.join(', ')}
            </div>
          ) : null}
          <div className="small muted" style={{ marginTop: 10 }}>
            Never reuse another creator's footage without permission. Upload only campaign assets you are authorised to use.
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader icon={Globe} title="Saved campaigns" sub={`${campaigns.length} stored on the server`} />
        {!campaigns.length ? (
          <Empty icon={Megaphone} title="No campaigns yet" sub="Research a product and save the brief to reuse it in future clipping runs." />
        ) : (
          <div className="stack">
            {campaigns.map((c) => (
              <div key={c.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{c.title}</div>
                  <div className="small muted">
                    {c.url ? c.url.slice(0, 60) : 'no URL'} · {timeAgo(c.updatedAt)}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {c.brief ? <Badge tone="ok">brief ready</Badge> : <Badge>no brief</Badge>}
                    {c.brief?.hashtags?.length ? <Badge>{c.brief.hashtags.length} hashtags</Badge> : null}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {c.brief ? (
                    <button type="button" className="btn sm ghost" onClick={() => setViewing(c)}>View</button>
                  ) : null}
                  <button type="button" className="btn sm ghost" onClick={() => useInProject(c)}>
                    <Copy size={13} /> Use
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => setDeleting(c)} aria-label="Delete campaign">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title || 'Campaign'} wide>
        {viewing ? (
          <div className="stack">
            {viewing.description ? <p className="small">{viewing.description}</p> : null}
            {viewing.url ? <div className="small muted mono">{viewing.url}</div> : null}
            <BriefBlock label="Benefits" items={viewing.brief?.benefits} />
            <BriefBlock label="Angles" items={viewing.brief?.angles} />
            <BriefBlock label="Hooks" items={viewing.brief?.hooks} />
            <BriefBlock label="CTAs" items={viewing.brief?.ctas} />
            <BriefBlock label="Hashtags" items={viewing.brief?.hashtags} />
            <BriefBlock label="Ideas" items={viewing.brief?.ideas} />
            {viewing.brief?.script ? <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{viewing.brief.script}</pre> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete campaign?"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" className="btn danger sm" onClick={remove} disabled={busy === 'delete'}>Delete</button>
          </div>
        }
      >
        <p className="small">The saved research for “{deleting?.title}” will be removed. Clips already generated are not affected.</p>
      </Modal>
    </div>
  );
}
