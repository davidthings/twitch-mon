import React, { useEffect, useState } from 'react';
import { Box, Heading, Text, Button, Flex, Card, Separator, TextField, Code, Callout } from '@radix-ui/themes';
import Layout from '../components/Layout';
import { buildAuthUrl, generateState } from '../lib/oauth';
import { useAuth } from '../lib/useAuth';
import Link from 'next/link';
import { loadSettings, saveSettings } from '../lib/settings';

export default function Home() {
  const { authed, user, ready } = useAuth();
  const [twitchClientId, setTwitchClientId] = useState('');
  const [twitchClientSecret, setTwitchClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = loadSettings();
    setTwitchClientId(s.twitchClientId || '');
    setTwitchClientSecret(s.twitchClientSecret || '');
    setRedirectUri(s.redirectUri || '');
  }, []);

  function onLogin() {
    const state = generateState();
    try { sessionStorage.setItem('oauth_state', state); } catch {}
    const scopes = [
      'user:read:email',
      'moderator:read:chatters',
      'moderator:read:followers',
      'channel:read:subscriptions',
    ];
    const url = buildAuthUrl({ scopes, state });
    window.location.href = url;
  }

  function onSaveSettings() {
    saveSettings({ twitchClientId, twitchClientSecret, redirectUri });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <Layout>
      <Box>
        <Heading size="8" mb="2">Twitch Mon</Heading>
        <Text size="3" color="gray">Static Next.js app using Twitch OAuth (Implicit) and Helix.</Text>
        <Separator my="4" />
        <Card size="3" mb="4">
          <Flex direction="column" gap="3">
            <Heading size="5">Setup — Twitch App Credentials</Heading>
            <Text size="3">Enter your Twitch credentials. These are stored in your browser only.</Text>
            <Flex direction="column" gap="2">
              <label>
                <Text as="div" size="2" color="gray">Twitch Client ID</Text>
                <TextField.Root value={twitchClientId} onChange={e => setTwitchClientId(e.target.value)} placeholder="u796di1d..." />
              </label>
              <label>
                <Text as="div" size="2" color="gray">Twitch Client Secret (optional; not used in this static app)</Text>
                <TextField.Root type="password" value={twitchClientSecret} onChange={e => setTwitchClientSecret(e.target.value)} placeholder="••••••" />
              </label>
              <label>
                <Text as="div" size="2" color="gray">Redirect URI (optional; leave blank to auto-use current origin + /callback/)</Text>
                <TextField.Root value={redirectUri} onChange={e => setRedirectUri(e.target.value)} placeholder="https://<user>.github.io/<repo>/callback/" />
              </label>
            </Flex>
            <Flex gap="3" align="center" wrap="wrap">
              <Button onClick={onSaveSettings}>Save</Button>
              {saved && <Text color="green">Saved</Text>}
            </Flex>
            <Callout.Root>
              <Callout.Text>
                <strong>How to get these:</strong>
                <br />
                - Go to <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">Twitch Developer Console</a> and create an app.
                <br />
                - Copy the <Code>Client ID</Code>. Generate a <Code>Client Secret</Code> (not used by this SPA but stored for future backend use).
                <br />
                - Add your Redirect URI. For GitHub Pages repo site, use: <Code>https://&lt;user&gt;.github.io/&lt;repo&gt;/callback/</Code>. For local dev, use: <Code>http://localhost:3000/callback/</Code>.
              </Callout.Text>
            </Callout.Root>
          </Flex>
        </Card>

        {!ready ? (
          <Card size="3"><Text>Loading…</Text></Card>
        ) : (
          !authed ? (
            <Card size="3">
              <Flex direction="column" gap="3">
                <Text size="3">Sign in to enable API calls.</Text>
                <Button onClick={onLogin} size="3" disabled={!twitchClientId}>Sign in with Twitch</Button>
                {!twitchClientId && (
                  <Text size="2" color="red">Provide a Client ID above to enable sign-in.</Text>
                )}
              </Flex>
            </Card>
          ) : (
            <Card size="3">
              <Flex direction="column" gap="3">
                <Text size="3">Signed in as <strong>{user?.display_name || user?.login || 'user'}</strong></Text>
                <Flex gap="3" wrap="wrap">
                  <Link href="/app"><Button>Open App</Button></Link>
                  <Link href="/charts"><Button>Viewer Chart</Button></Link>
                  <Link href="/chatters"><Button>Chatters</Button></Link>
                </Flex>
              </Flex>
            </Card>
          )
        )}
      </Box>
    </Layout>
  );
}
