import Link from 'next/link';
import { Flex, Box, Button } from '@radix-ui/themes';
import { clearToken } from '../lib/tokenStorage';
import { toPath } from '../lib/oauth';
import { useAuth } from '../lib/useAuth';

export default function Nav() {
  const { authed, ready } = useAuth();
  return (
    <Flex align="center" justify="between" p="3" style={{ borderBottom: '1px solid var(--gray-6)' }}>
      <Flex gap="3" align="center">
        <Box><Link href="/"><strong>Twitch Mon</strong></Link></Box>
        <Link href="/overview">Overview</Link>
        <Link href="/charts">Charts</Link>
        <Link href="/chatters">Chatters</Link>
      </Flex>
      <Box>
        <Button
          variant={authed ? 'soft' : 'solid'}
          color={authed ? 'red' : 'violet'}
          onClick={() => {
            if (authed) {
              clearToken();
              location.href = toPath('/');
            } else {
              location.href = toPath('/');
            }
          }}
        >
          {authed ? 'Logout' : 'Login'}
        </Button>
      </Box>
    </Flex>
  );
}
