import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const AppContext = createContext(null);

/**
 * Draft state that must survive page navigation (the brief requires an
 * uploaded file not to be lost when the user switches section). Kept in a
 * module-level store rather than React state because each page unmounts.
 */
const draft = {
  file: null,
  fileName: '',
  url: '',
  config: null,
};
export const getDraft = () => draft;
export const setDraft = (patch) => Object.assign(draft, patch);

const ACTIVE_JOB_KEY = 'oc_active_job';
export const readActiveJob = () => {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
  } catch {
    return null;
  }
};
export const writeActiveJob = (job) => {
  try {
    if (job) localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
    else localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    /* storage full / private mode — the job still runs, the banner just won't persist */
  }
};

export function AppProvider({ children }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [engine, setEngine] = useState({ status: 'unknown' });
  const toastId = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((kind, message, ms = 4600) => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-3), { id, kind, message }]);
    if (ms) setTimeout(() => dismissToast(id), ms);
    return id;
  }, [dismissToast]);

  const checkEngine = useCallback(async () => {
    const res = await api.probeEngine();
    setEngine(res.ok ? { status: 'online' } : { status: 'offline', ...res });
    return res;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.state();
      setState(fresh);
      setLoadError(null);
      checkEngine();
      return fresh;
    } catch (err) {
      setLoadError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [checkEngine]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const saveSettings = useCallback(async (patch) => {
    // 1. send  2. server persists  3. re-read from server  4. confirm it stuck
    await api.saveSettings(patch);
    const fresh = await api.state();
    setState(fresh);
    const notApplied = Object.keys(patch).filter((key) => {
      if (key === 'notifications') return false;
      return JSON.stringify(fresh.settings?.[key]) !== JSON.stringify(patch[key]);
    });
    if (notApplied.length) {
      throw new Error(`The server did not keep these settings: ${notApplied.join(', ')}`);
    }
    return fresh;
  }, []);

  const saveSecrets = useCallback(async (secrets) => {
    const res = await api.saveSecrets(secrets);
    const fresh = await api.state();
    setState(fresh);
    return res;
  }, []);

  const value = useMemo(
    () => ({
      state,
      loading,
      loadError,
      toasts,
      toast,
      dismissToast,
      refresh,
      checkEngine,
      engine,
      saveSettings,
      saveSecrets,
      settings: state?.settings || {},
      projects: state?.projects || [],
      campaigns: state?.campaigns || [],
      accounts: state?.accounts || [],
      posts: state?.posts || [],
      backend: state?.backend || { configured: false, url: '', source: 'none' },
      integrations: state?.integrations || { geminiKey: false, uploadPostKey: false, uploadPostUser: '' },
    }),
    [state, loading, loadError, toasts, toast, dismissToast, refresh, checkEngine, engine, saveSettings, saveSecrets],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
