import { getAccessToken } from './tokenStorage';
import { getClientId } from './oauth';

const API_BASE = 'https://api.twitch.tv/helix';

export async function apiGet(path, query = {}) {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: {
      'Client-Id': getClientId(),
      'Authorization': `Bearer ${token}`,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Helix ${path} failed: ${res.status} ${txt}`);
  }
  return await res.json();
}

export async function getMe() {
  return apiGet('/users');
}

export async function getUsersByLogin(login) {
  return apiGet('/users', { login });
}

export async function getStreamsByLogin(user_login) {
  return apiGet('/streams', { user_login });
}

export async function getChannel(broadcaster_id) {
  return apiGet('/channels', { broadcaster_id });
}

export async function getGame(id) {
  return apiGet('/games', { id });
}

export async function getFollowersSummary(broadcaster_id) {
  return apiGet('/channels/followers', { broadcaster_id, first: '1' });
}

export async function getSubscriptions(broadcaster_id) {
  return apiGet('/subscriptions', { broadcaster_id, first: '100' });
}

export async function getChatters(broadcaster_id, moderator_id, after) {
  const params = { broadcaster_id, moderator_id };
  if (after) params.after = after;
  return apiGet('/chat/chatters', params);
}
