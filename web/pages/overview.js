import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../lib/useAuth';
import { getMe, getUsersByLogin, getStreamsByLogin, getChannel, getGame, getFollowersSummary, getSubscriptions } from '../lib/helix';
import { Box, Heading, Text, Card, Flex, TextField, Button, Separator, Code } from '@radix-ui/themes';
import { getSelectedChannel, setSelectedChannel, getRecentChannels } from '../lib/settings';

function JsonBox({ data }) {
  return (
    <Box style={{ maxHeight: 320, overflow: 'auto' }}>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
    </Box>
  );
}

export default function OverviewPage() {
  const { authed, user } = useAuth();
  const [me, setMe] = useState(null);
  const [meOpen, setMeOpen] = useState(false);
  const [channelText, setChannelText] = useState('');
  const [streams, setStreams] = useState(null);
  const [overview, setOverview] = useState(null);
  const [followers, setFollowers] = useState(null);
  const [subs, setSubs] = useState(null);
  const [loading, setLoading] = useState('');
  const [meError, setMeError] = useState('');
  const [tabError, setTabError] = useState('');
  const [recents, setRecents] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const pollRef = React.useRef(null);
  const aliveRef = React.useRef(true);
  const [chanStatus, setChanStatus] = useState('');

  useEffect(() => {
    const sel = getSelectedChannel();
    setChannelText(sel || '');
    setRecents(getRecentChannels());
  }, []);

  // Do not prefetch Me; only fetch on button click

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, []);

  // Clear tab-specific errors when leaving the tab or clearing channel
  useEffect(() => {
    if (!activeTab || !channelText.trim()) {
      setTabError('');
    }
  }, [activeTab, channelText]);

  async function toggleMe() {
    if (meOpen) { setMeOpen(false); return; }
    setMeError('');
    if (me) { setMeOpen(true); return; }
    setLoading('me');
    try {
      const resp = await getMe();
      if (!aliveRef.current) return;
      setMe(resp.data?.[0] || null);
      setMeOpen(true);
    } catch (e) { if (aliveRef.current) setMeError(e.message); }
    if (aliveRef.current) setLoading('');
  }

  async function applyChannel(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    setTabError('');
    setSelectedChannel(trimmed);
    setRecents(getRecentChannels());
    setChannelText(trimmed);
    await fetchOverview(trimmed);
  }

  async function fetchStreams(login) {
    const target = (login ?? channelText).trim();
    if (!target) return;
    setLoading('streams'); setTabError('');
    try {
      const resp = await getStreamsByLogin(target);
      if (!aliveRef.current) return;
      setStreams(resp);
    } catch (e) { if (aliveRef.current) setTabError(e.message); }
    if (aliveRef.current) setLoading('');
  }

  async function fetchOverview(login) {
    const targetLogin = (login ?? channelText).trim();
    if (!targetLogin) return;
    setLoading('overview'); setTabError('');
    try {
      const users = await getUsersByLogin(targetLogin);
      const target = users.data?.[0];
      if (!target) throw new Error('User not found');
      const streamResp = await getStreamsByLogin(targetLogin);
      const stream = streamResp.data?.[0] || null;
      let channel = null;
      try { const ch = await getChannel(target.id); channel = ch.data?.[0] || null; } catch {}
      let game = null; const gameId = (stream && stream.game_id) || (channel && channel.game_id);
      if (gameId) { try { const g = await getGame(gameId); game = g.data?.[0] || null; } catch {} }
      if (!aliveRef.current) return;
      setOverview({ user: target, stream, channel, game });
      const when = new Date().toLocaleTimeString();
      const gameName = game?.name || null;
      const title = stream?.title || null;
      const statusStr = `${when} — ${targetLogin}: ${stream ? `${stream.viewer_count} viewers` : 'offline'}${gameName ? ' — ' + gameName : ''}${title ? ' — ' + title : ''}`;
      setChanStatus(statusStr);
    } catch (e) { if (aliveRef.current) setTabError(e.message); }
    if (aliveRef.current) setLoading('');
  }

  async function fetchFollowers() {
    const targetLogin = channelText.trim();
    if (!targetLogin) return;
    setLoading('followers'); setTabError('');
    try {
      const users = await getUsersByLogin(targetLogin);
      const target = users.data?.[0];
      if (!target) throw new Error('Broadcaster not found');
      const resp = await getFollowersSummary(target.id);
      if (!aliveRef.current) return;
      setFollowers(resp);
    } catch (e) { if (aliveRef.current) setTabError(e.message); }
    if (aliveRef.current) setLoading('');
  }

  async function fetchSubs() {
    const targetLogin = channelText.trim();
    if (!targetLogin) return;
    setLoading('subs'); setTabError('');
    try {
      const users = await getUsersByLogin(targetLogin);
      const target = users.data?.[0];
      if (!target) throw new Error('Broadcaster not found');
      const resp = await getSubscriptions(target.id);
      if (!aliveRef.current) return;
      setSubs(resp);
    } catch (e) { if (aliveRef.current) setTabError(e.message); }
    if (aliveRef.current) setLoading('');
  }

  function fetchForTab(tab) {
    if (tab === 'overview') return fetchOverview();
    if (tab === 'streams') return fetchStreams();
    if (tab === 'followers') return fetchFollowers();
    if (tab === 'subs') return fetchSubs();
  }

  useEffect(() => {
    if (!authed) return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    const hasChannel = !!channelText.trim();
    if (!hasChannel || !activeTab) return;
    setTabError('');
    fetchForTab(activeTab);
    pollRef.current = setInterval(() => {
      fetchForTab(activeTab);
    }, 30000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [activeTab, channelText, authed]);

  if (!authed) {
    return (
      <Layout>
        <Heading size="7">Overview</Heading>
        <Text>You are not signed in. Go back to Home.</Text>
      </Layout>
    );
  }

  return (
    <Layout>
      <Box>
        <Heading size="7" mb="2">Overview</Heading>
        <Text size="3" color="gray">Signed in as <strong>{user?.display_name || user?.login}</strong></Text>
        <Separator my="4" />

        <Card mb="4">
          <Flex direction="column" gap="3">
            <Heading size="5">Me</Heading>
            <Flex gap="3" align="center" wrap="wrap">
              <Text size="3">User: <strong>{user?.display_name || user?.login}</strong></Text>
              <Button onClick={toggleMe} disabled={loading==='me'}>{meOpen ? 'Hide' : 'Info'}</Button>
            </Flex>
            {meError && <Text color="red" as="p">Error: <Code>{meError}</Code></Text>}
            {meOpen && me && <JsonBox data={me} />}
          </Flex>
        </Card>

        <Card mb="4">
          <Flex direction="column" gap="3">
            <Heading size="5">Channel</Heading>
            <Flex gap="3" align="center" wrap="wrap">
              <TextField.Root value={channelText} onChange={e => setChannelText(e.target.value)} placeholder="channel login" />
              <Button onClick={() => applyChannel(channelText)} disabled={!channelText.trim()}>Set Channel</Button>
              {recents.length > 0 && (
                <Flex gap="2" align="center" wrap="wrap">
                  <Text color="gray">Recent:</Text>
                  {recents.map((r) => (
                    <Button key={r} variant="soft" onClick={() => applyChannel(r)}>{r}</Button>
                  ))}
                </Flex>
              )}
            </Flex>
            {chanStatus && <Text color="gray">{chanStatus}</Text>}
            <Flex gap="2" wrap="wrap">
              <Button variant={activeTab==='overview' ? 'solid' : 'soft'} onClick={() => setActiveTab(t => t==='overview' ? null : 'overview')} disabled={!channelText.trim()}>Overview</Button>
              <Button variant={activeTab==='streams' ? 'solid' : 'soft'} onClick={() => setActiveTab(t => t==='streams' ? null : 'streams')} disabled={!channelText.trim()}>Streams</Button>
              <Button variant={activeTab==='followers' ? 'solid' : 'soft'} onClick={() => setActiveTab(t => t==='followers' ? null : 'followers')} disabled={!channelText.trim()}>Followers</Button>
              <Button variant={activeTab==='subs' ? 'solid' : 'soft'} onClick={() => setActiveTab(t => t==='subs' ? null : 'subs')} disabled={!channelText.trim()}>Subscriptions</Button>
            </Flex>
            {tabError && <Text color="red" as="p">Error: <Code>{tabError}</Code></Text>}
            {!channelText.trim() ? (
              <Text color="gray">Set a channel to view data.</Text>
            ) : (
              <Box>
                {activeTab==='overview' && overview && (
                  <Box>
                    <Heading size="4">Overview</Heading>
                    <JsonBox data={overview} />
                  </Box>
                )}
                {activeTab==='streams' && streams && (
                  <Box>
                    <Heading size="4">Streams</Heading>
                    <JsonBox data={streams} />
                  </Box>
                )}
                {activeTab==='followers' && followers && (
                  <Box>
                    <Heading size="4">Followers summary</Heading>
                    <JsonBox data={followers} />
                  </Box>
                )}
                {activeTab==='subs' && subs && (
                  <Box>
                    <Heading size="4">Subscriptions</Heading>
                    <JsonBox data={subs} />
                  </Box>
                )}
              </Box>
            )}
          </Flex>
        </Card>
      </Box>
    </Layout>
  );
}
