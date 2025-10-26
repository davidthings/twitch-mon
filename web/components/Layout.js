import React from 'react';
import { Container, Box } from '@radix-ui/themes';
import Nav from './Nav';

export default function Layout({ children }) {
  return (
    <Box>
      <Nav />
      <Container size="3" p="3">
        {children}
      </Container>
    </Box>
  );
}
