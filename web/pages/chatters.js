import React, { useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../lib/useAuth';
import { getUsersByLogin, getChatters } from '../lib/helix';
import { Box, Heading, Text, Card, Flex, TextField, Button, Separator, Code } from '@radix-ui/themes';

export default function ChattersPage() {
  const { authed, user } = useAuth();
  const [broadcasterLogin, setBroadcasterLogin] = useState('ToastRackTV');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

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

      setResult({ broadcaster: { id: b.id, login: b.login, display_name: b.display_name }, total: list.length, chatters: list });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

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
        <Card mb="4">
          <Flex gap="3" align="center" wrap="wrap">
            <TextField.Root value={broadcasterLogin} onChange={e => setBroadcasterLogin(e.target.value)} placeholder="broadcaster login" />
            <Button onClick={fetchChatters} disabled={loading}>Fetch chatters</Button>
          </Flex>
        </Card>
        {result && (
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
      </Box>
    </Layout>
  );
}
