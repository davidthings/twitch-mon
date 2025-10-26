'use strict';
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const tokenStore = require('./tokenStore');
const createTwitchClient = require('./twitch');

const PORT = process.env.PORT || 3000;
const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
const redirectUri = process.env.TWITCH_REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
  console.error('Missing env: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_REDIRECT_URI');
  process.exit(1);
}

const twitch = createTwitchClient({ clientId, clientSecret, redirectUri });

const app = express();
app.use(express.json());

const stateStore = new Map();
const chatterSnapshots = new Map();

function computeExpiry(expiresIn) {
  return Date.now() + (expiresIn - 60) * 1000; // refresh a minute early
}

async function ensureAccessToken(userId) {
  const tokens = tokenStore.getTokensForUser(userId);
  if (!tokens) return null;
  if (tokens.expires_at && Date.now() < tokens.expires_at && tokens.access_token) {
    return tokens.access_token;
  }
  if (tokens.refresh_token) {
    const refreshed = await twitch.refreshAccessToken(tokens.refresh_token);
    const updated = {
      ...tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      scope: refreshed.scope || tokens.scope,
      token_type: refreshed.token_type || tokens.token_type,
      expires_at: computeExpiry(refreshed.expires_in),
    };
    tokenStore.setTokensForUser(userId, updated);
    return updated.access_token;
  }
  return null;
}

app.get('/', (_req, res) => {
  const { code, state, scope } = _req.query || {};
  if (code && state) {
    const params = new URLSearchParams({ code, state });
    if (scope) params.set('scope', scope);
    return res.redirect(`/callback?${params.toString()}`);
  }
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Twitch Helix local app</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.5; margin: 2rem; }
    a { color: #9146FF; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .card { max-width: 720px; padding: 1rem 1.25rem; border: 1px solid #eee; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.03); }
    input[type="text"] { padding: 0.5rem; border: 1px solid #ccc; border-radius: 6px; }
    button { padding: 0.5rem 0.8rem; background: #9146FF; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    button:hover { filter: brightness(0.95); }
    ul { padding-left: 1.25rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Twitch Helix local app</h1>
    <ul>
      <li><a href="/login">/login</a> – start OAuth</li>
      <li><a href="/callback">/callback</a> – OAuth redirect (used by Twitch)</li>
      <li><a href="/me">/me</a> – current user info (requires login)</li>
      <li><a href="/charts">/charts</a> – live viewer chart</li>
    </ul>
    <h2>Streams lookup</h2>
    <form action="/streams" method="get">
      <label for="user_login">User login:</label>
      <input id="user_login" name="user_login" type="text" placeholder="channel_name" required />
      <button type="submit">Fetch</button>
    </form>

    <h2>Channel overview</h2>
    <p>Get aggregated info about a channel (user, stream, channel, game):</p>
    <p>Quick link: <a href="/channel_overview?user_login=ToastRackTV">/channel_overview?user_login=ToastRackTV</a></p>
    <form action="/channel_overview" method="get">
      <label for="overview_login">User login:</label>
      <input id="overview_login" name="user_login" type="text" placeholder="ToastRackTV" required />
      <button type="submit">Fetch overview</button>
    </form>

    <h2>Chatters</h2>
    <p>List current chatters (from TMI; excludes viewers not connected to chat):</p>
    <p>Quick link: <a href="/chatters?user_login=ToastRackTV">/chatters?user_login=ToastRackTV</a></p>
    <form action="/chatters" method="get">
      <label for="chatters_login">User login:</label>
      <input id="chatters_login" name="user_login" type="text" placeholder="ToastRackTV" required />
      <button type="submit">Fetch chatters</button>
    </form>

    <h2>Owner features (requires broadcaster/mod login)</h2>
    <ul>
      <li><a href="/chatters_official?broadcaster_login=ToastRackTV">/chatters_official?broadcaster_login=ToastRackTV</a></li>
      <li><a href="/followers_summary?broadcaster_login=ToastRackTV">/followers_summary?broadcaster_login=ToastRackTV</a></li>
      <li><a href="/subscriptions_summary?broadcaster_login=ToastRackTV">/subscriptions_summary?broadcaster_login=ToastRackTV</a></li>
    </ul>
  </div>
</body>
</html>`);
});

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, Date.now());
  // Request broader scopes to enable owner features if the user is the broadcaster/moderator.
  const scopes = [
    'user:read:email',
    'moderator:read:chatters',
    'moderator:read:followers',
    'channel:read:subscriptions'
  ];
  const url = twitch.buildAuthUrl({ state, scopes });
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`OAuth error: ${error} ${error_description || ''}`);
  if (!code || !state) return res.status(400).send('Missing code or state');
  if (!stateStore.has(state)) return res.status(400).send('Invalid state');
  stateStore.delete(state);

  try {
    const token = await twitch.exchangeCodeForToken(code);
    const accessToken = token.access_token;
    const expiresAt = computeExpiry(token.expires_in);

    const me = await twitch.apiGet('/users', accessToken);
    const user = me.data && me.data[0];
    if (!user) return res.status(500).send('Failed to fetch user');

    const saved = {
      access_token: accessToken,
      refresh_token: token.refresh_token,
      scope: token.scope,
      token_type: token.token_type,
      expires_at: expiresAt,
      user,
    };
    tokenStore.setTokensForUser(user.id, saved);

    res.type('html').send(
`<h1>Authenticated as ${user.display_name}</h1>
<p>You can now call:</p>
<ul>
<li><a href="/me">/me</a></li>
<li><a href="/streams?user_login=${encodeURIComponent(user.login)}">/streams?user_login=${user.login}</a></li>
<li><a href="/channel_overview?user_login=${encodeURIComponent(user.login)}">/channel_overview?user_login=${user.login}</a></li>
</ul>
<p><a href="/">Back to Home</a></p>`
    );
  } catch (e) {
    console.error('Callback error:', e.response?.data || e.message);
    res.status(500).send('Auth failed. See server logs.');
  }
});

app.get('/me', async (_req, res) => {
  const users = tokenStore.listUserIds();
  if (users.length === 0) return res.status(401).send('Not authenticated. Visit /login');
  const userId = users[0];
  try {
    const accessToken = await ensureAccessToken(userId);
    if (!accessToken) return res.status(401).send('No valid token. Visit /login');
    const me = await twitch.apiGet('/users', accessToken);
    res.json(me);
  } catch (e) {
    console.error('ME error:', e.response?.data || e.message);
    res.status(500).send('Failed to fetch /users');
  }
});

app.get('/streams', async (req, res) => {
  const { user_login } = req.query;
  if (!user_login) return res.status(400).send('Missing user_login');
  const users = tokenStore.listUserIds();
  if (users.length === 0) return res.status(401).send('Not authenticated. Visit /login');
  const userId = users[0];
  try {
    const accessToken = await ensureAccessToken(userId);
    if (!accessToken) return res.status(401).send('No valid token. Visit /login');
    const data = await twitch.apiGet('/streams', accessToken, { user_login });
    res.json(data);
  } catch (e) {
    console.error('Streams error:', e.response?.data || e.message);
    res.status(500).send('Failed to fetch /streams');
  }
});

app.get('/channel_overview', async (req, res) => {
  const { user_login } = req.query;
  if (!user_login) return res.status(400).send('Missing user_login');
  const users = tokenStore.listUserIds();
  if (users.length === 0) return res.status(401).send('Not authenticated. Visit /login');
  const userId = users[0];

  try {
    const accessToken = await ensureAccessToken(userId);
    if (!accessToken) return res.status(401).send('No valid token. Visit /login');

    const usersResp = await twitch.apiGet('/users', accessToken, { login: user_login });
    const targetUser = usersResp.data?.[0];
    if (!targetUser) return res.status(404).send('User not found');

    const streamResp = await twitch.apiGet('/streams', accessToken, { user_login });
    const stream = streamResp.data?.[0] || null;

    let channel = null;
    try {
      const channelResp = await twitch.apiGet('/channels', accessToken, { broadcaster_id: targetUser.id });
      channel = channelResp.data?.[0] || null;
    } catch (err) {
      console.warn('Channel info not available (may require broadcaster token):', err.response?.status || err.message);
    }

    let game = null;
    const gameId = (stream && stream.game_id) || (channel && channel.game_id);
    if (gameId) {
      try {
        const gameResp = await twitch.apiGet('/games', accessToken, { id: gameId });
        game = gameResp.data?.[0] || null;
      } catch (err) {
        console.warn('Failed to fetch game info:', err.response?.status || err.message);
      }
    }

    return res.json({ user: targetUser, stream, channel, game });
  } catch (e) {
    console.error('Overview error:', e.response?.data || e.message);
    res.status(500).send('Failed to build channel overview');
  }
});

app.get('/metrics/stream', async (req, res) => {
  const { user_login } = req.query;
  if (!user_login) return res.status(400).json({ error: 'Missing user_login' });
  const users = tokenStore.listUserIds();
  if (users.length === 0) return res.status(401).json({ error: 'Not authenticated. Visit /login' });
  const userId = users[0];

  try {
    const accessToken = await ensureAccessToken(userId);
    if (!accessToken) return res.status(401).json({ error: 'No valid token. Visit /login' });
    const streamResp = await twitch.apiGet('/streams', accessToken, { user_login });
    const stream = streamResp.data?.[0] || null;
    const ts = Date.now();
    let is_live = false;
    let viewer_count = null;
    let title = null;
    let game_id = null;
    let game_name = null;

    if (stream) {
      is_live = stream.type === 'live';
      viewer_count = stream.viewer_count ?? null;
      title = stream.title ?? null;
      game_id = stream.game_id ?? null;
    }

    if (game_id) {
      try {
        const gameResp = await twitch.apiGet('/games', accessToken, { id: game_id });
        game_name = gameResp.data?.[0]?.name || null;
      } catch (_) {}
    }

    return res.json({ ts, is_live, viewer_count, title, game_id, game_name, user_login });
  } catch (e) {
    console.error('Metrics error:', e.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

app.get('/charts', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Live Viewer Chart</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.5; margin: 2rem; }
    .row { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
    input[type="text"] { padding: 0.5rem; border: 1px solid #ccc; border-radius: 6px; }
    button { padding: 0.5rem 0.8rem; background: #9146FF; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    button:hover { filter: brightness(0.95); }
    #status { margin-top: .5rem; color: #555; }
    .links { margin-bottom: 1rem; }
    a { color: #9146FF; text-decoration: none; }
    a:hover { text-decoration: underline; }
    canvas { max-width: 100%; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3"></script>
  </head>
<body>
  <div class="links"><a href="/">Home</a></div>
  <h1>Live Viewer Chart</h1>
  <div class="row">
    <label for="login">Channel login:</label>
    <input id="login" type="text" value="ToastRackTV" />
    <button id="start">Start</button>
    <button id="stop">Stop</button>
    <button id="clear">Clear</button>
  </div>
  <div id="status">Idle</div>
  <div style="height: 380px; margin-top: 1rem;">
    <canvas id="chart"></canvas>
  </div>

  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    const data = { datasets: [{ label: 'Viewer Count', data: [], borderColor: '#9146FF', backgroundColor: 'rgba(145,70,255,0.15)', tension: 0.2, spanGaps: true, pointRadius: 0 }] };
    const chart = new Chart(ctx, {
      type: 'line',
      data,
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'PPpp' } },
          y: { beginAtZero: true, ticks: { precision: 0 } }
        },
        plugins: { legend: { display: false } }
      }
    });

    let timer = null;
    const statusEl = document.getElementById('status');
    const loginEl = document.getElementById('login');

    function setStatus(text) { statusEl.textContent = text; }

    function addPoint(ts, y) {
      data.datasets[0].data.push({ x: ts, y });
      // Keep last 2 hours worth of points at 10s intervals (~720 points)
      const maxPoints = 720;
      const points = data.datasets[0].data;
      if (points.length > maxPoints) points.splice(0, points.length - maxPoints);
      chart.update('none');
    }

    async function pollOnce() {
      const login = loginEl.value.trim();
      if (!login) { setStatus('Enter a channel login'); return; }
      try {
        const resp = await fetch('/metrics/stream?user_login=' + encodeURIComponent(login), { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const j = await resp.json();
        addPoint(j.ts, j.is_live ? j.viewer_count : null);
        const when = new Date(j.ts).toLocaleTimeString();
        setStatus(when + ' — ' + j.user_login + ': ' + (j.is_live ? (j.viewer_count + ' viewers') : 'offline') + (j.game_name ? ' — ' + j.game_name : '') + (j.title ? ' — ' + j.title : ''));
      } catch (e) {
        setStatus('Error: ' + e.message);
      }
    }

    function start() {
      if (timer) return; // already running
      pollOnce();
      timer = setInterval(pollOnce, 10000);
      setStatus('Polling…');
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; setStatus('Stopped'); }
    }

    function clearAll() {
      data.datasets[0].data.length = 0;
      chart.update();
      setStatus('Cleared');
    }

    document.getElementById('start').addEventListener('click', start);
    document.getElementById('stop').addEventListener('click', stop);
    document.getElementById('clear').addEventListener('click', clearAll);
  </script>
</body>
</html>`);
});

app.get('/chatters', async (req, res) => {
  const { user_login } = req.query;
  if (!user_login) return res.status(400).send('Missing user_login');
  try {
    const url = 'https://tmi.twitch.tv/group/user/' + encodeURIComponent(user_login) + '/chatters';
    const resp = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
    const c = resp.data && resp.data.chatters;
    if (!c) return res.status(502).send('Unexpected TMI response');
    const roles = ['broadcaster', 'vips', 'moderators', 'staff', 'admins', 'global_mods', 'viewers'];
    let list = [];
    const by_role = {};
    for (const role of roles) {
      const arr = Array.isArray(c[role]) ? c[role] : [];
      by_role[role] = arr.length;
      list = list.concat(arr);
    }
    const total = list.length;

    const prev = chatterSnapshots.get(user_login) || new Set();
    const curr = new Set(list);
    const joined = [];
    const left = [];
    for (const name of curr) if (!prev.has(name)) joined.push(name);
    for (const name of prev) if (!curr.has(name)) left.push(name);
    chatterSnapshots.set(user_login, curr);

    return res.json({ user_login, total, by_role, joined, left, chatters: list });
  } catch (e) {
    console.error('Chatters error:', e.response?.status, e.response?.data || e.message);
    return res.status(500).send('Failed to fetch chatters');
  }
});

// Official chatters via Helix (requires broadcaster/mod token with moderator:read:chatters)
app.get('/chatters_official', async (req, res) => {
  const { broadcaster_login } = req.query;
  if (!broadcaster_login) return res.status(400).send('Missing broadcaster_login');
  const users = tokenStore.listUserIds();
  if (users.length === 0) return res.status(401).send('Not authenticated. Visit /login');
  const userId = users[0];

  try {
    const accessToken = await ensureAccessToken(userId);
    if (!accessToken) return res.status(401).send('No valid token. Visit /login');

    // Resolve broadcaster id
    const u = await twitch.apiGet('/users', accessToken, { login: broadcaster_login });
    const broadcaster = u.data?.[0];
    if (!broadcaster) return res.status(404).send('Broadcaster not found');

    // Moderator id is the authed user id
    const authed = tokenStore.getTokensForUser(userId)?.user;
    const moderator_id = authed?.id;
    if (!moderator_id) return res.status(400).send('Missing authed user context');

    const list = [];
    let cursor = undefined;
    let pages = 0;
    do {
      const params = { broadcaster_id: broadcaster.id, moderator_id };
      if (cursor) params.after = cursor;
      const resp = await twitch.apiGet('/chat/chatters', accessToken, params);
      const data = resp.data || [];
      for (const c of data) list.push({ user_id: c.user_id, user_login: c.user_login, user_name: c.user_name });
      cursor = resp.pagination && resp.pagination.cursor;
      pages += 1;
      if (pages > 10) break; // safety cap
    } while (cursor);

    return res.json({ broadcaster: { id: broadcaster.id, login: broadcaster.login, display_name: broadcaster.display_name }, total: list.length, chatters: list });
  } catch (e) {
    console.error('Official chatters error:', e.response?.data || e.message);
    const status = e.response?.status || 500;
    return res.status(status).send('Failed to fetch official chatters');
  }
});

// Followers summary via Helix (requires moderator:read:followers with mod/broadcaster token)
app.get('/followers_summary', async (req, res) => {
  const { broadcaster_login } = req.query;
  if (!broadcaster_login) return res.status(400).send('Missing broadcaster_login');
  const users = tokenStore.listUserIds();
  if (users.length === 0) return res.status(401).send('Not authenticated. Visit /login');
  const userId = users[0];

  try {
    const accessToken = await ensureAccessToken(userId);
    if (!accessToken) return res.status(401).send('No valid token. Visit /login');
    const u = await twitch.apiGet('/users', accessToken, { login: broadcaster_login });
    const broadcaster = u.data?.[0];
    if (!broadcaster) return res.status(404).send('Broadcaster not found');

    const resp = await twitch.apiGet('/channels/followers', accessToken, { broadcaster_id: broadcaster.id, first: '1' });
    const latest = resp.data?.[0] || null;
    const summary = { latest };
    if (typeof resp.total === 'number') summary.total = resp.total;
    return res.json(summary);
  } catch (e) {
    console.error('Followers summary error:', e.response?.data || e.message);
    const status = e.response?.status || 500;
    return res.status(status).send('Failed to fetch followers');
  }
});

// Subscriptions summary via Helix (requires channel:read:subscriptions with broadcaster token)
app.get('/subscriptions_summary', async (req, res) => {
  const { broadcaster_login } = req.query;
  if (!broadcaster_login) return res.status(400).send('Missing broadcaster_login');
  const users = tokenStore.listUserIds();
  if (users.length === 0) return res.status(401).send('Not authenticated. Visit /login');
  const userId = users[0];

  try {
    const accessToken = await ensureAccessToken(userId);
    if (!accessToken) return res.status(401).send('No valid token. Visit /login');
    const u = await twitch.apiGet('/users', accessToken, { login: broadcaster_login });
    const broadcaster = u.data?.[0];
    if (!broadcaster) return res.status(404).send('Broadcaster not found');

    const resp = await twitch.apiGet('/subscriptions', accessToken, { broadcaster_id: broadcaster.id, first: '100' });
    const subs = resp.data || [];
    const pagination = resp.pagination || null;
    return res.json({ count: subs.length, pagination, data: subs });
  } catch (e) {
    console.error('Subscriptions summary error:', e.response?.data || e.message);
    const status = e.response?.status || 500;
    return res.status(status).send('Failed to fetch subscriptions');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
