import { useEffect, useState } from 'react';
import { loadToken } from './tokenStorage';

export function useAuth() {
  const [state, setState] = useState({ authed: false, token: null, user: null, ready: false });
  useEffect(() => {
    const t = loadToken();
    setState({ authed: !!t, token: t, user: t?.user || null, ready: true });
  }, []);
  return state;
}
