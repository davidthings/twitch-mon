import { loadSettings } from './settings';
const BASE_AUTH = 'https://id.twitch.tv/oauth2/authorize';

export function getClientId() {
  const fromSettings = (typeof window !== 'undefined') ? (loadSettings().twitchClientId || '') : '';
  const id = fromSettings || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  if (!id) throw new Error('Missing NEXT_PUBLIC_TWITCH_CLIENT_ID');
  return id;
}

export function getBasePath() {
  return process.env.NEXT_PUBLIC_BASE_PATH || '';
}

export function buildRedirectUri() {
  if (typeof window === 'undefined') return '';
  const fromSettings = loadSettings().redirectUri;
  if (fromSettings) {
    try {
      const u = new URL(fromSettings, window.location.origin);
      let pathname = u.pathname || '/';
      if (pathname.endsWith('/callback/')) return `${u.origin}${pathname}`;
      if (pathname.endsWith('/callback')) return `${u.origin}${pathname}/`;
      if (pathname.endsWith('/')) pathname += 'callback/';
      else pathname += '/callback/';
      return `${u.origin}${pathname}`;
    } catch {
      // Fallback string handling
      const s = String(fromSettings);
      if (s.endsWith('/callback/')) return s;
      if (s.endsWith('/callback')) return s + '/';
      if (s.endsWith('/')) return s + 'callback/';
      return s + '/callback/';
    }
  }
  const basePath = getBasePath();
  const path = basePath ? `${basePath}/callback/` : '/callback/';
  return `${window.location.origin}${path}`;
}

export function toPath(p) {
  const base = getBasePath();
  const path = p.startsWith('/') ? p : `/${p}`;
  return base ? `${base}${path}` : path;
}

export function buildAuthUrl({ scopes, state }) {
  const clientId = getClientId();
  const redirect_uri = buildRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri,
    response_type: 'token',
    scope: (scopes || []).join(' '),
    state,
    force_verify: 'true',
  });
  return `${BASE_AUTH}?${params.toString()}`;
}

export function generateState() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2);
}

export function parseHashFragment(hash) {
  const h = (hash || '').replace(/^#/, '');
  const params = new URLSearchParams(h);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

export async function validateToken(accessToken) {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Validate failed: ${res.status}`);
  return await res.json();
}
