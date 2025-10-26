import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../lib/useAuth';
import { getMe, getUsersByLogin, getStreamsByLogin, getChannel, getGame, getFollowersSummary, getSubscriptions } from '../lib/helix';
import { Box, Heading, Text, Card, Flex, TextField, Button, Separator, Code } from '@radix-ui/themes';

function JsonBox({ data }) {
  return (
    <Box style={{ maxHeight: 320, overflow: 'auto' }}>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
    </Box>
  );
}

export default function AppPage() {
  const { authed, user } = useAuth();
  const [me, setMe] = useState(null);
  const [login, setLogin] = useState('ToastRackTV');
  const [streams, setStreams] = useState(null);
  const [overview, setOverview] = useState(null);
  const [followers, setFollowers] = useState(null);
  const [subs, setSubs] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function run() {
      if (!authed) return;
      try {
        const resp = await getMe();
        setMe(resp.data?.[0] || null);
      } catch (e) {
        setError(e.message);
      }
    }
    run();
  }, [authed]);

  async function fetchStreams() {
    setLoading('streams'); setError('');
    try {
      const resp = await getStreamsByLogin(login);
      setStreams(resp);
    } catch (e) { setError(e.message); }
    setLoading('');
  }

  async function fetchOverview() {
    setLoading('overview'); setError('');
    try {
      const users = await getUsersByLogin(login);
      const target = users.data?.[0];
      if (!target) throw new Error('User not found');
      const streamResp = await getStreamsByLogin(login);
      const stream = streamResp.data?.[0] || null;
      let channel = null;
      try { const ch = await getChannel(target.id); channel = ch.data?.[0] || null; } catch {}
      let game = null; const gameId = (stream && stream.game_id) || (channel && channel.game_id);
      if (gameId) { try { const g = await getGame(gameId); game = g.data?.[0] || null; } catch {} }
      setOverview({ user: target, stream, channel, game });
    } catch (e) { setError(e.message); }
    setLoading('');
  }

  async function fetchFollowers() {
    setLoading('followers'); setError('');
    try {
      const users = await getUsersByLogin(login);
      const target = users.data?.[0];
      if (!target) throw new Error('Broadcaster not found');
      const resp = await getFollowersSummary(target.id);
      setFollowers(resp);
    } catch (e) { setError(e.message); }
    setLoading('');
  }

  async function fetchSubs() {
    setLoading('subs'); setError('');
    try {
      const users = await getUsersByLogin(login);
      const target = users.data?.[0];
      if (!target) throw new Error('Broadcaster not found');
      const resp = await getSubscriptions(target.id);
      setSubs(resp);
    } catch (e) { setError(e.message); }
    setLoading('');
  }

  if (!authed) {
    return (
      <Layout>
        <Heading size="7">App</Heading>
        <Text>You are not signed in. Go back to Home.</Text>
      </Layout>
    );
  }

  return (
    <Layout>
      <Box>
        <Heading size="7" mb="2">App</Heading>
        <Text size="3" color="gray">Signed in as <strong>{user?.display_name || user?.login}</strong></Text>
        <Separator my="4" />

        {error && <Text color="red" as="p">Error: <Code>{error}</Code></Text>}

        <Card mb="4">
          <Flex direction="column" gap="3">
            <Heading size="5">Me</Heading>
            <Button onClick={() => getMe().then(r => setMe(r.data?.[0] || null)).catch(e => setError(e.message))} disabled={loading==='me'}>
              Fetch /users (me)
            </Button>
            {me && <JsonBox data={me} />}
          </Flex>
        </Card>

        <Card mb="4">
          <Flex direction="column" gap="3">
            <Heading size="5">Channel inputs</Heading>
            <Flex gap="3" align="center" wrap="wrap">
              <TextField.Root value={login} onChange={e => setLogin(e.target.value)} placeholder="channel login" />
              <Button onClick={fetchStreams} disabled={loading==='streams'}>Streams</Button>
              <Button onClick={fetchOverview} disabled={loading==='overview'}>Overview</Button>
              <Button onClick={fetchFollowers} disabled={loading==='followers'}>Followers summary</Button>
              <Button onClick={fetchSubs} disabled={loading==='subs'}>Subscriptions</Button>
            </Flex>
            {streams && (
              <Box>
                <Heading size="4">Streams</Heading>
                <JsonBox data={streams} />
              </Box>
            )}
            {overview && (
              <Box>
                <Heading size="4">Overview</Heading>
                <JsonBox data={overview} />
              </Box>
            )}
            {followers && (
              <Box>
                <Heading size="4">Followers summary</Heading>
                <JsonBox data={followers} />
              </Box>
            )}
            {subs && (
              <Box>
                <Heading size="4">Subscriptions</Heading>
                <JsonBox data={subs} />
              </Box>
            )}
          </Flex>
        </Card>
      </Box>
    </Layout>
  );
}
