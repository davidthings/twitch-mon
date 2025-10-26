import React from 'react';
import Head from 'next/head';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';

export default function MyApp({ Component, pageProps }) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return (
    <Theme appearance="light" accentColor="violet" grayColor="sand">
      <Head>
        <link rel="icon" href={`${base}/favicon.svg`} type="image/svg+xml" />
      </Head>
      <Component {...pageProps} />
    </Theme>
  );
}
