import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../lib/useAuth';
import { getStreamsByLogin, getGame } from '../lib/helix';
import { Box, Heading, Text, Card, Flex, TextField, Button, Separator, Code, Checkbox } from '@radix-ui/themes';

export default function ChartsPage() {
  const { authed } = useAuth();
  const [login, setLogin] = useState('ToastRackTV');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [points, setPoints] = useState([]); // {x: ts, y: viewers|null, game_name, title}
  const [showOffline, setShowOffline] = useState(true);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const timerRef = useRef(null);

  const maxPoints = 720; // ~2h at 10s interval

  async function pollOnce() {
    const name = login.trim();
    if (!name) { setStatus('Enter a channel login'); return; }
    try {
      const resp = await getStreamsByLogin(name);
      const stream = resp.data?.[0] || null;
      const ts = Date.now();
      let gameName = null;
      let title = null;
      let viewers = null;
      if (stream) {
        title = stream.title || null;
        viewers = stream.viewer_count ?? null;
        if (stream.game_id) {
          try {
            const g = await getGame(stream.game_id);
            gameName = g.data?.[0]?.name || null;
          } catch {}
        }
      }
      const pt = { x: ts, y: stream ? viewers : (showOffline ? null : 0), title, game_name: gameName };
      setPoints(prev => {
        const next = [...prev, pt];
        if (next.length > maxPoints) next.splice(0, next.length - maxPoints);
        return next;
      });
      const when = new Date(ts).toLocaleTimeString();
      setStatus(`${when} — ${name}: ${stream ? `${viewers} viewers` : 'offline'}${gameName ? ' — ' + gameName : ''}${title ? ' — ' + title : ''}`);
    } catch (e) {
      setStatus('Error: ' + e.message);
    }
  }

  function start() {
    if (timerRef.current) return;
    setRunning(true);
    pollOnce();
    timerRef.current = setInterval(pollOnce, 10000);
    setStatus('Polling…');
  }

  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRunning(false);
    setStatus('Stopped');
  }

  // Setup ECharts lazily on client
  useEffect(() => {
    let disposed = false;
    async function init() {
      const echarts = await import('echarts');
      if (disposed) return;
      const el = chartRef.current;
      if (!el) return;
      const inst = echarts.init(el);
      chartInstance.current = inst;
      const handleResize = () => inst.resize();
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        inst.dispose();
      };
    }
    const cleanupPromise = init();
    return () => { disposed = true; cleanupPromise.then(fn => fn && fn()); };
  }, []);

  // Update chart when points change or setting changes
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    const seriesData = points.map(p => [p.x, p.y]);
    inst.setOption({
      animation: false,
      grid: { left: 40, right: 16, top: 16, bottom: 40 },
      tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? 'offline' : String(v)) },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', min: 0 },
      series: [
        {
          type: 'line',
          name: 'Viewers',
          showSymbol: false,
          smooth: 0.25,
          areaStyle: {},
          data: seriesData,
          connectNulls: !showOffline,
        },
      ],
    });
  }, [points, showOffline]);

  useEffect(() => () => stop(), []);

  if (!authed) {
    return (
      <Layout>
        <Heading size="7">Viewer Chart</Heading>
        <Text>You are not signed in. Go back to Home.</Text>
      </Layout>
    );
  }

  return (
    <Layout>
      <Box>
        <Heading size="7">Viewer Chart</Heading>
        <Separator my="3" />
        <Card mb="3">
          <Flex gap="3" align="center" wrap="wrap">
            <TextField.Root value={login} onChange={e => setLogin(e.target.value)} placeholder="channel login" />
            {!running ? (
              <Button onClick={start}>Start</Button>
            ) : (
              <Button color="red" onClick={stop}>Stop</Button>
            )}
            <Button variant="soft" onClick={() => setPoints([])}>Clear</Button>
            <Flex align="center" gap="2">
              <Checkbox checked={showOffline} onCheckedChange={(v) => setShowOffline(!!v)} />
              <Text>Show gaps when offline</Text>
            </Flex>
          </Flex>
          <Text mt="2" color="gray">{status}</Text>
        </Card>
        <Box style={{ height: 380 }}>
          <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
        </Box>
      </Box>
    </Layout>
  );
}
