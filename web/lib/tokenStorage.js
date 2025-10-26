export function saveToken(token) {
  try {
    sessionStorage.setItem('twitch_token', JSON.stringify(token));
  } catch {}
}

export function loadToken() {
  try {
    const raw = sessionStorage.getItem('twitch_token');
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t && typeof t.expires_at === 'number' && Date.now() > t.expires_at) {
      // expired
      sessionStorage.removeItem('twitch_token');
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

export function clearToken() {
  try { sessionStorage.removeItem('twitch_token'); } catch {}
}

export function getAccessToken() {
  const t = loadToken();
  return t?.access_token || null;
}
