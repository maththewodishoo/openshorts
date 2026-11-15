/** Small shared helpers. Nothing here invents data. */

export const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', color: '#ff4d4d' },
  { id: 'tiktok', label: 'TikTok', color: '#22d3ee' },
  { id: 'instagram', label: 'Instagram', color: '#e1306c' },
  { id: 'facebook', label: 'Facebook', color: '#3b82f6' },
  { id: 'x', label: 'X', color: '#a8b3cf' },
  { id: 'linkedin', label: 'LinkedIn', color: '#38bdf8' },
];

export const platformLabel = (id) => PLATFORMS.find((p) => p.id === id)?.label || id;

/** Sources the engine's yt-dlp based importer is known to handle. */
export const URL_SOURCES = [
  { id: 'youtube', label: 'YouTube', test: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i },
  { id: 'tiktok', label: 'TikTok', test: /(^|\.)(tiktok\.com)$/i },
  { id: 'instagram', label: 'Instagram', test: /(^|\.)(instagram\.com)$/i },
  { id: 'facebook', label: 'Facebook', test: /(^|\.)(facebook\.com|fb\.watch)$/i },
  { id: 'x', label: 'X / Twitter', test: /(^|\.)(x\.com|twitter\.com)$/i },
  { id: 'twitch', label: 'Twitch', test: /(^|\.)(twitch\.tv)$/i },
  { id: 'vimeo', label: 'Vimeo', test: /(^|\.)(vimeo\.com)$/i },
];

/**
 * Validates a video URL before any processing starts.
 * Returns { ok, source, message }. A platform that requires a login is not
 * "unsupported" — the message says so, because the engine will fail too.
 */
export function validateVideoUrl(raw) {
  const value = (raw || '').trim();
  if (!value) return { ok: false, message: 'Paste a video link first.' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: 'That is not a valid URL. Include https:// and the full link.' };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, message: 'Only http:// and https:// links are supported.' };
  }
  const source = URL_SOURCES.find((s) => s.test.test(url.hostname));
  if (!source) {
    return {
      ok: false,
      message: `Unrecognised source (${url.hostname}). Supported: YouTube, TikTok, Instagram, Facebook, X, Twitch, Vimeo. Upload the file instead.`,
    };
  }
  return { ok: true, source: source.id, message: `${source.label} link looks valid.` };
}

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm'];
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // engine-side default cap

export function validateVideoFile(file) {
  if (!file) return { ok: false, message: 'Choose a video file.' };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    return { ok: false, message: `${ext.toUpperCase() || 'That'} is not supported. Use MP4, MOV, MKV or WEBM.` };
  }
  if (!file.size) return { ok: false, message: 'That file is empty.' };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` };
  }
  return { ok: true, message: `${file.name} · ${formatBytes(file.size)}` };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSeconds(value) {
  const s = Math.max(0, Math.round(Number(value) || 0));
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

export function formatClock(value) {
  const s = Math.max(0, Math.round(Number(value) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const ASPECTS = [
  { value: '9:16', label: '9:16 Vertical', engine: 'vertical' },
  { value: '16:9', label: '16:9 Landscape', engine: 'horizontal' },
  { value: '1:1', label: '1:1 Square', engine: 'square' },
  { value: '4:5', label: '4:5 Portrait', engine: 'vertical' },
];

export const engineFormat = (aspect) => ASPECTS.find((a) => a.value === aspect)?.engine || 'vertical';

/** Engine clip payloads vary by pipeline version — read defensively, never fake. */
export function normalizeClip(clip, index) {
  const start = Number(clip?.start ?? clip?.start_time ?? 0) || 0;
  const end = Number(clip?.end ?? clip?.end_time ?? 0) || 0;
  return {
    index: Number.isInteger(clip?.index) ? clip.index : index,
    title: clip?.title || clip?.name || `Clip ${index + 1}`,
    hook: clip?.hook || clip?.opening_hook || '',
    reason: clip?.reason || clip?.justification || clip?.rationale || '',
    score: Number.isFinite(Number(clip?.score)) ? Number(clip.score) : Number.isFinite(Number(clip?.potential_score)) ? Number(clip.potential_score) : null,
    transcript: clip?.transcript || clip?.text || '',
    start,
    end,
    duration: Number(clip?.duration) || Math.max(0, end - start),
    videoUrl: clip?.video_url || clip?.url || '',
    thumbnail: clip?.thumbnail || clip?.thumbnail_url || '',
    captionStyle: clip?.caption_style || '',
    raw: clip,
  };
}
