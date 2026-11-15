import React, { useState } from 'react';
import { Share2, CheckCircle2, AlertTriangle, Trash2, Link2, ShieldCheck, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Card, CardHeader, Field, Badge, Banner, Spinner, Modal, Empty } from '../ui';
import { PLATFORMS, platformLabel } from '../lib/utils';

/**
 * Accounts are only shown as connected after the publishing provider confirms
 * the profile. Without the provider key the page says SETUP REQUIRED and never
 * pretends an account exists.
 */
export default function SocialAccounts({ go }) {
  const { accounts, integrations, refresh, toast, settings } = useApp();
  const [editing, setEditing] = useState(null);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState(null);

  const providerReady = !!integrations.uploadPostKey;
  const accountFor = (platform) => accounts.find((a) => a.platform === platform);

  const openConnect = (platform) => {
    setEditing(platform);
    setHandle('');
    setError('');
    setNote('');
  };

  const verify = async () => {
    setError('');
    setNote('');
    if (!providerReady) {
      setError('SETUP REQUIRED: add your Upload-Post API key in Settings before connecting accounts.');
      return;
    }
    if (!handle.trim()) {
      setError('Enter the account username on the platform.');
      return;
    }
    setBusy('verify');
    try {
      const res = await api.socialUser();
      const profiles = res?.profiles || res?.accounts || res?.users || [];
      const list = Array.isArray(profiles) ? profiles : [];
      const match = list.find(
        (p) =>
          String(p.platform || p.provider || '').toLowerCase() === editing &&
          (!p.username || p.username.toLowerCase() === handle.trim().toLowerCase()),
      );
      const ok = !!match || res?.success === true || res?.connected === true;
      if (!ok) {
        setError(
          `The provider did not confirm a ${platformLabel(editing)} account. Add the account inside Upload-Post first, then retry. Provider response: ${JSON.stringify(
            res,
          ).slice(0, 240)}`,
        );
        return;
      }
      const permissions = match?.permissions || match?.scopes || res?.permissions || ['publish'];
      await api.saveAccount({
        platform: editing,
        username: handle.trim(),
        displayName: match?.name || match?.display_name || handle.trim(),
        status: 'connected',
        verifiedAt: new Date().toISOString(),
        permissions: Array.isArray(permissions) ? permissions : ['publish'],
        provider: 'upload-post',
      });
      await refresh();
      toast('ok', `${platformLabel(editing)} connected and verified.`);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!removing) return;
    setBusy('remove');
    try {
      await api.deleteAccount(removing.id);
      await refresh();
      toast('ok', 'Account disconnected.');
      setRemoving(null);
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
          icon={Share2}
          title="Social accounts"
          sub="Publishing goes through the engine's Upload-Post integration"
          action={<Badge tone={providerReady ? 'ok' : 'warn'}>{providerReady ? 'provider key saved' : 'setup required'}</Badge>}
        />
        {!providerReady ? (
          <Banner tone="warn" icon={KeyRound}>
            <strong>SETUP REQUIRED.</strong> Add your Upload-Post API key in Settings → API providers. Accounts can only be
            connected once the provider can verify them; nothing is marked connected locally.
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn sm primary" onClick={() => go('settings')}>Open settings</button>
            </div>
          </Banner>
        ) : (
          <Banner tone="info" icon={ShieldCheck}>
            Accounts must already exist inside your Upload-Post workspace. Connect here verifies the profile with the provider
            before saving it.
          </Banner>
        )}
        {settings.uploadPostUser ? (
          <div className="small muted" style={{ marginTop: 8 }}>
            Upload-Post user: <span className="mono">{settings.uploadPostUser}</span>
          </div>
        ) : null}
      </Card>

      {error ? <Banner tone="err" icon={AlertTriangle}>{error}</Banner> : null}

      <div className="g2">
        {PLATFORMS.map((p) => {
          const acc = accountFor(p.id);
          return (
            <Card key={p.id}>
              <div className="between">
                <div className="row" style={{ gap: 10 }}>
                  <span className="dot" style={{ background: p.color, width: 10, height: 10 }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.label}</div>
                    <div className="small muted">
                      {acc ? acc.username : providerReady ? 'not connected' : 'provider not configured'}
                    </div>
                  </div>
                </div>
                {acc ? <Badge tone="ok">connected</Badge> : <Badge>disconnected</Badge>}
              </div>
              {acc ? (
                <>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Permissions: {(acc.permissions || []).join(', ') || 'publish'}
                  </div>
                  <div className="small muted">
                    Verified {acc.verifiedAt ? new Date(acc.verifiedAt).toLocaleString() : 'earlier'}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <button type="button" className="btn sm ghost" onClick={() => setRemoving(acc)}>
                      <Trash2 size={13} /> Disconnect
                    </button>
                  </div>
                </>
              ) : (
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className={`btn sm ${providerReady ? 'primary' : ''}`}
                    onClick={() => (providerReady ? openConnect(p.id) : go('settings'))}
                  >
                    <Link2 size={13} /> {providerReady ? 'Connect account' : 'Setup required'}
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {!accounts.length ? (
        <Card>
          <Empty icon={CheckCircle2} title="No verified accounts" sub="Connect a provider account to enable publishing and scheduling." />
        </Card>
      ) : null}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Connect ${editing ? platformLabel(editing) : ''}`}
        footer={
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn primary sm" onClick={verify} disabled={busy === 'verify'}>
              {busy === 'verify' ? <Spinner size={14} /> : <ShieldCheck size={14} />} Verify with provider
            </button>
          </div>
        }
      >
        <p className="small muted">
          The account must already be added in Upload-Post. This page verifies it with the provider and only then stores it as
          connected.
        </p>
        <Field label="Account username">
          <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@yourhandle" />
        </Field>
        {note ? <Banner tone="info">{note}</Banner> : null}
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Disconnect account?"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" className="btn danger sm" onClick={disconnect} disabled={busy === 'remove'}>Disconnect</button>
          </div>
        }
      >
        <p className="small">
          This removes the local link for {removing ? platformLabel(removing.platform) : ''} ({removing?.username}). It does not
          revoke the provider's own authorisation.
        </p>
      </Modal>
    </div>
  );
}
