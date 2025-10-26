const axios = require('axios');
const crypto = require('crypto');

function createTwitchClient({ clientId, clientSecret, redirectUri }) {
  const authBase = 'https://id.twitch.tv/oauth2';
  const apiBase = 'https://api.twitch.tv/helix';

  function buildAuthUrl({ scopes = ['user:read:email'], state }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state: state || crypto.randomBytes(16).toString('hex'),
      force_verify: 'true',
    });
    return `${authBase}/authorize?${params.toString()}`;
  }

  async function exchangeCodeForToken(code) {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const res = await axios.post(`${authBase}/token`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return res.data;
  }

  async function refreshAccessToken(refreshToken) {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await axios.post(`${authBase}/token`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return res.data;
  }

  async function apiGet(path, accessToken, query = {}) {
    const url = new URL(`${apiBase}${path}`);
    Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, v));

    const res = await axios.get(url.toString(), {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.data;
  }

  return { buildAuthUrl, exchangeCodeForToken, refreshAccessToken, apiGet };
}

module.exports = createTwitchClient;
