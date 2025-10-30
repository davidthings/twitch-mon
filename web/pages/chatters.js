import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import ChattersChart from '../components/ChattersChart';
import { useAuth } from '../lib/useAuth';
import { getUsersByLogin, getChatters } from '../lib/helix';
import { Box, Heading, Text, Card, Flex, Button, Separator, Code } from '@radix-ui/themes';
import Link from 'next/link';
import { getSelectedChannel } from '../lib/settings';

export default function ChattersPage() {
  const { authed, user } = useAuth();
  const [broadcasterLogin, setBroadcasterLogin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [visible, setVisible] = useState(false);

  const LS_LAST_LOGIN = 'tm_chatters_last_login';
  const resultKey = (lg) => `tm_chatters_result_${lg}`;
  const loadJSON = (k, d) => {
    if (typeof window === 'undefined') return d;
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch { return d; }
  };
  const saveJSON = (k, v) => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };

  async function fetchChatters() {
    setLoading(true); setError(''); setResult(null);
    try {
      const users = await getUsersByLogin(broadcasterLogin);
      const b = users.data?.[0];
      if (!b) throw new Error('Broadcaster not found');
      if (!user) throw new Error('Missing authed user');
      const broadcaster_id = b.id;
      const moderator_id = user.id;

      const list = [];
      let after = undefined;
      let pages = 0;
      do {
        const resp = await getChatters(broadcaster_id, moderator_id, after);
        const data = resp.data || [];
        for (const c of data) list.push({ user_id: c.user_id, user_login: c.user_login, user_name: c.user_name });
        after = resp.pagination && resp.pagination.cursor;
        pages += 1;
        if (pages > 10) break; // safety cap
      } while (after);

      const res = { broadcaster: { id: b.id, login: b.login, display_name: b.display_name }, total: list.length, chatters: list };
      setResult(res);
      saveJSON(LS_LAST_LOGIN, b.login);
      saveJSON(resultKey(b.login), res);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  function handleToggle() {
    if (visible) {
      setVisible(false);
      return;
    }
    if (result) {
      setVisible(true);
      return;
    }
    fetchChatters();
    setVisible(true);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const selected = getSelectedChannel();
    if (selected) setBroadcasterLogin(selected);
    const last = loadJSON(LS_LAST_LOGIN, null);
    const keyLogin = selected || last;
    if (keyLogin) {
      const saved = loadJSON(resultKey(keyLogin), null);
      if (saved) setResult(saved);
    }
  }, []);

  if (!authed) {
    return (
      <Layout>
        <Heading size="7">Chatters</Heading>
        <Text>You are not signed in. Go back to Home.</Text>
      </Layout>
    );
  }

  return (
    <Layout>
      <Box>
        <Heading size="7">Chatters</Heading>
        <Text color="gray">Requires moderator:read:chatters scope and you must be a moderator of the broadcaster.</Text>
        <Separator my="3" />
        {error && <Text color="red" as="p">Error: <Code>{error}</Code></Text>}
        {!broadcasterLogin ? (
          <Card mb="4">
            <Text>Select a channel on the <Link href="/overview">Overview</Link> page.</Text>
          </Card>
        ) : (
          <Card mb="4">
            <Flex gap="3" align="center" wrap="wrap">
              <Text>Channel: <Code>{broadcasterLogin}</Code></Text>
              <Button onClick={handleToggle} disabled={loading}>{visible ? 'Hide Chatters' : 'Show Chatters'}</Button>
            </Flex>
          </Card>
        )}
        {visible && result && (
          <Card>
            <Heading size="5">{result.broadcaster.display_name} ({result.broadcaster.login}) — {result.total} chatters</Heading>
            <Box mt="2" style={{ maxHeight: 360, overflow: 'auto' }}>
              <ul>
                {result.chatters.map((c) => (
                  <li key={c.user_id}><Code>{c.user_login}</Code> — {c.user_name}</li>
                ))}
              </ul>
            </Box>
          </Card>
        )}
        <Box mt="4">
          <ChattersChart />
        </Box>
      </Box>
    </Layout>
  );
}
