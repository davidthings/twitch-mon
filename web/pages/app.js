import React, { useEffect } from 'react';
import Layout from '../components/Layout';
import { Heading, Text } from '@radix-ui/themes';
import { useRouter } from 'next/router';

export default function AppPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/overview');
  }, [router]);
  return (
    <Layout>
      <Heading size="7">Redirecting…</Heading>
      <Text>If you are not redirected automatically, go to /overview.</Text>
    </Layout>
  );
}
