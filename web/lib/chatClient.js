// Lightweight wrapper to read Twitch chat messages anonymously using tmi.js in the browser.
// Loaded dynamically from components to avoid SSR.

export async function createAnonChatClient(channelLogin, onMessage) {
  if (!channelLogin) throw new Error('Missing channelLogin');
  // Import tmi.js lazily to keep SSR paths clean
  const mod = await import('tmi.js');
  const Client = mod.Client || (mod.default && mod.default.Client);
  if (!Client) throw new Error('tmi.js Client not found');

  const client = new Client({
    options: { debug: false },
    connection: { secure: true, reconnect: true },
    channels: ['#' + String(channelLogin).toLowerCase()]
  });

  client.on('message', (channel, tags, message, self) => {
    try {
      if (self) return;
      const login = (tags && tags.username) ? String(tags.username).toLowerCase() : '';
      if (!login) return;
      const txt = (message == null) ? '' : String(message);
      const id = (tags && (tags.id || tags['id'])) || undefined;
      const t = Date.now();
      if (typeof onMessage === 'function') onMessage({ login, txt, id, t });
    } catch {}
  });

  client.on('connected', () => { /* no-op */ });
  client.on('disconnected', () => { /* no-op */ });
  client.on('reconnect', () => { /* no-op */ });

  return {
    async connect() { try { await client.connect(); } catch (e) { /* swallow */ } },
    async disconnect() { try { await client.disconnect(); } catch (e) { /* swallow */ } },
  };
}
