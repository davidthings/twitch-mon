const KEY = 'twitch_mon_settings_v1';

export function loadSettings() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return typeof obj === 'object' && obj ? obj : {};
  } catch {
    return {};
  }
}

export function saveSettings(partial) {
  if (typeof window === 'undefined') return;
  try {
    const prev = loadSettings();
    const next = { ...prev, ...partial };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    // ignore
  }
}
