import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { parseHashFragment, validateToken, toPath } from '../lib/oauth';
import { saveToken } from '../lib/tokenStorage';
import { getMe } from '../lib/helix';
import { Box, Heading, Text, Code } from '@radix-ui/themes';

export default function Callback() {
  const [status, setStatus] = useState('Processing OAuth response...');
  const [error, setError] = useState(null);

  useEffect(() => {
    async function run() {
      try {
        const params = parseHashFragment(window.location.hash);
        if (params.error) throw new Error(`${params.error}: ${params.error_description || ''}`);
        const expectedState = sessionStorage.getItem('oauth_state');
        if (!params.state || !expectedState || params.state !== expectedState) {
          throw new Error('State mismatch');
        }
        sessionStorage.removeItem('oauth_state');
        const access_token = params.access_token;
        const token_type = params.token_type;
        const scope = (params.scope || '').split(' ').filter(Boolean);
        const expires_in = Number(params.expires_in || 0);
        if (!access_token) throw new Error('Missing access_token');

        setStatus('Validating token...');
        const v = await validateToken(access_token);
        const now = Date.now();
        const expires_at = now + Math.max(0, (expires_in || v.expires_in || 0) - 60) * 1000;

        // Save minimal token so Helix calls can succeed
        saveToken({ access_token, token_type, scope, expires_in, expires_at });

        setStatus('Fetching user profile...');
        const me = await getMe();
        const user = me.data?.[0] || null;
        if (!user) throw new Error('Failed to fetch user');

        // Save user-enriched token for later use
        saveToken({ access_token, token_type, scope, expires_in, expires_at, user });
        setStatus('All set. Redirecting...');
        window.location.replace(toPath('/app'));
      } catch (e) {
        console.error(e);
        setError(e.message || String(e));
        setStatus('');
      }
    }
    run();
  }, []);

  return (
    <Layout>
      <Box>
        <Heading>OAuth Callback</Heading>
        {status && <Text as="p">{status}</Text>}
        {error && (
          <Text as="p" color="red">
            Error: <Code>{error}</Code>
          </Text>
        )}
      </Box>
    </Layout>
  );
}
