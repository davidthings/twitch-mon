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
  const [intervalMs, setIntervalMs] = useState(10000);
  const [blink, setBlink] = useState(false);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const timerRef = useRef(null);
  const blinkTimerRef = useRef(null);

  const maxPoints = 720; // ~2h at 10s interval

  const RATES = [2000, 5000, 10000, 30000];
  const nextRate = (ms) => {
    const i = RATES.indexOf(ms);
    return RATES[(i >= 0 ? i + 1 : 0) % RATES.length];
  };

  const LS_LAST_LOGIN = 'tm_charts_last_login';
  const LS_INTERVAL = 'tm_charts_interval_ms';
  const LS_SHOW_OFFLINE = 'tm_charts_show_offline';
  const pointsKey = (lg) => `tm_charts_points_${lg}`;
  const loadJSON = (k, d) => {
    if (typeof window === 'undefined') return d;
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch { return d; }
  };
  const saveJSON = (k, v) => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };

  async function pollOnce() {
    const name = login.trim();
    if (!name) { setStatus('Enter a channel login'); return; }
    try {
      if (blinkTimerRef.current) { clearTimeout(blinkTimerRef.current); blinkTimerRef.current = null; }
      setBlink(true);
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
        const next = [...prev];
        const last = prev[prev.length - 1];
        if (last && typeof last.x === 'number') {
          const gapMs = ts - last.x;
          if (gapMs > intervalMs * 1.5) {
            next.push({ x: ts - 1, y: null, title: null, game_name: null, gap: true });
          }
        }
        next.push(pt);
        if (next.length > maxPoints) next.splice(0, next.length - maxPoints);
        return next;
      });
      const when = new Date(ts).toLocaleTimeString();
      setStatus(`${when} — ${name}: ${stream ? `${viewers} viewers` : 'offline'}${gameName ? ' — ' + gameName : ''}${title ? ' — ' + title : ''}`);
      blinkTimerRef.current = setTimeout(() => { setBlink(false); blinkTimerRef.current = null; }, 400);
    } catch (e) {
      setStatus('Error: ' + e.message);
      blinkTimerRef.current = setTimeout(() => { setBlink(false); blinkTimerRef.current = null; }, 400);
    }
  }

  function start() {
    if (timerRef.current) return;
    setRunning(true);
    pollOnce();
    setStatus('Polling…');
    saveJSON(LS_LAST_LOGIN, login.trim());
  }

  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (blinkTimerRef.current) { clearTimeout(blinkTimerRef.current); blinkTimerRef.current = null; }
    setBlink(false);
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

  const viewerSeriesData = useMemo(() => points.map(p => [p.x, p.y]), [points]);
  const deltaSeriesData = useMemo(() => {
    const arr = [];
    let prev = null;
    for (const p of points) {
      const y = p.y;
      if (y == null || prev == null) {
        arr.push([p.x, null]);
        if (y != null) prev = y;
      } else {
        arr.push([p.x, y - prev]);
        prev = y;
      }
    }
    return arr;
  }, [points]);

  const gapAreas = useMemo(() => {
    const areas = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p && p.gap) {
        // find previous real sample
        let j = i - 1;
        while (j >= 0 && (points[j].y == null)) j--;
        const prevX = j >= 0 ? points[j].x : null;
        const nextX = points[i + 1] ? points[i + 1].x : (p.x + 1);
        if (prevX != null && nextX != null && nextX > prevX) {
          areas.push([{ xAxis: prevX }, { xAxis: nextX }]);
        }
      }
    }
    return areas;
  }, [points]);

  // Update chart when points change or setting changes
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    inst.setOption({
      animation: false,
      grid: [
        { left: 40, right: 16, top: 16, height: '40%', containLabel: true },
        { left: 40, right: 16, top: '63%', bottom: 40, containLabel: true },
      ],
      tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? 'offline' : String(v)) },
      xAxis: [
        { type: 'time', gridIndex: 0 },
        { type: 'time', gridIndex: 1 },
      ],
      yAxis: [
        { type: 'value', min: 0, name: 'Viewers', gridIndex: 0 },
        { type: 'value', name: 'Δ Viewers', gridIndex: 1 },
      ],
      series: [
        {
          type: 'line',
          name: 'Viewers',
          showSymbol: false,
          smooth: 0.25,
          areaStyle: {},
          data: viewerSeriesData,
          connectNulls: !showOffline,
          xAxisIndex: 0,
          yAxisIndex: 0,
          clip: true,
          markArea: gapAreas.length ? { silent: true, itemStyle: { color: 'rgba(255, 200, 0, 0.18)' }, data: gapAreas } : undefined,
        },
        {
          type: 'bar',
          name: 'Δ Viewers',
          data: deltaSeriesData,
          xAxisIndex: 1,
          yAxisIndex: 1,
          barWidth: 14,
          itemStyle: {
            color: (params) => {
              const v = Array.isArray(params.value) ? params.value[1] : params.value;
              if (v == null) return 'rgba(0,0,0,0)';
              return v >= 0 ? '#10b981' /* green */ : '#ef4444' /* red */;
            },
          },
          clip: true,
          markArea: gapAreas.length ? { silent: true, itemStyle: { color: 'rgba(255, 200, 0, 0.12)' }, data: gapAreas } : undefined,
        },
      ],
    });
  }, [points, showOffline]);

  useEffect(() => () => stop(), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const last = loadJSON(LS_LAST_LOGIN, null);
    const savedLogin = last || login;
    if (last) setLogin(savedLogin);
    const savedPoints = loadJSON(pointsKey(savedLogin), []);
    if (savedPoints && Array.isArray(savedPoints)) setPoints(savedPoints);
    const savedShow = loadJSON(LS_SHOW_OFFLINE, true);
    setShowOffline(!!savedShow);
    const savedInterval = loadJSON(LS_INTERVAL, 10000);
    setIntervalMs(savedInterval);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const name = login.trim();
    if (!name) return;
    const saved = loadJSON(pointsKey(name), []);
    if (Array.isArray(saved)) setPoints(saved);
  }, [login]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    saveJSON(LS_SHOW_OFFLINE, showOffline);
  }, [showOffline]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const name = login.trim();
    if (!name) return;
    saveJSON(LS_LAST_LOGIN, name);
    saveJSON(pointsKey(name), points);
  }, [points, login]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    saveJSON(LS_INTERVAL, intervalMs);
    if (running) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      timerRef.current = setInterval(pollOnce, intervalMs);
    }
  }, [intervalMs, running]);

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
        <Text color="gray">Access: Any channel. Requires Twitch login; no broadcaster/moderator privileges needed.</Text>
        <Separator my="3" />
        <Card mb="3">
          <Flex gap="3" align="center" wrap="wrap">
            <TextField.Root value={login} onChange={e => setLogin(e.target.value)} placeholder="channel login" />
            {!running ? (
              <Button onClick={start}>Start</Button>
            ) : (
              <Button color="red" onClick={stop}>Stop</Button>
            )}
            <Button variant="soft" onClick={() => { setPoints([]); if (typeof window !== 'undefined') { try { localStorage.removeItem(pointsKey(login.trim())); } catch {} } }}>Clear</Button>
            <Button variant="soft" onClick={() => setIntervalMs(nextRate(intervalMs))}>Interval: {Math.round(intervalMs/1000)}s</Button>
            <Box style={{ width: 10, height: 10, borderRadius: 999, background: blink ? 'var(--green-9)' : 'var(--gray-6)' }} title={blink ? 'Fetching' : 'Idle'} />
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
