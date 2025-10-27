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

export function getSelectedChannel() {
  const s = loadSettings();
  return s.selected_channel || '';
}

export function setSelectedChannel(login) {
  const name = (login || '').trim();
  if (!name) return loadSettings();
  const prev = loadSettings();
  const recents = Array.isArray(prev.recent_channels) ? prev.recent_channels.slice() : [];
  const existingIdx = recents.findIndex((x) => x.toLowerCase() === name.toLowerCase());
  if (existingIdx !== -1) recents.splice(existingIdx, 1);
  recents.unshift(name);
  while (recents.length > 10) recents.pop();
  return saveSettings({ selected_channel: name, recent_channels: recents });
}

export function getRecentChannels() {
  const s = loadSettings();
  return Array.isArray(s.recent_channels) ? s.recent_channels : [];
}

export function getSelectedTimeZone() {
  const s = loadSettings();
  return s.selected_time_zone || 'system';
}

export function setSelectedTimeZone(tz) {
  const val = (tz || 'system');
  const prev = loadSettings();
  const recents = Array.isArray(prev.recent_time_zones) ? prev.recent_time_zones.slice() : [];
  if (val && val !== 'system') {
    const idx = recents.findIndex((x) => x === val);
    if (idx !== -1) recents.splice(idx, 1);
    recents.unshift(val);
    while (recents.length > 5) recents.pop();
  }
  return saveSettings({ selected_time_zone: val, recent_time_zones: recents });
}

export function getRecentTimeZones() {
  const s = loadSettings();
  return Array.isArray(s.recent_time_zones) ? s.recent_time_zones : [];
}
