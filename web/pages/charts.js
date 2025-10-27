import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import Link from 'next/link';
import { useAuth } from '../lib/useAuth';
import { getStreamsByLogin, getGame } from '../lib/helix';
import { Box, Heading, Text, Card, Flex, Button, Separator, Code, Checkbox, TextField } from '@radix-ui/themes';
import { getSelectedChannel, getSelectedTimeZone, setSelectedTimeZone, getRecentTimeZones } from '../lib/settings';

export default function ChartsPage() {
  const { authed } = useAuth();
  const [login, setLogin] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [points, setPoints] = useState([]); // {x: ts, y: viewers|null, game_name, title}
  const [showOffline, setShowOffline] = useState(true);
  const [intervalMs, setIntervalMs] = useState(10000);
  const [autoMode, setAutoMode] = useState(false);
  const [blink, setBlink] = useState(false);
  const [timeZone, setTimeZone] = useState('system');
  const [tzInput, setTzInput] = useState('');
  const [tzRecents, setTzRecents] = useState([]);
  const [tzList, setTzList] = useState([]);
  const [tzEditing, setTzEditing] = useState(false);
  const [sessions, setSessions] = useState([]); // [{id,start,end,count}]
  const [selectedSessionId, setSelectedSessionId] = useState(null); // 'live' | sessionId | null
  const selectedSessionIdRef = useRef(null);
  const activeSessionIdRef = useRef(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const timerRef = useRef(null);
  const blinkTimerRef = useRef(null);

  const maxPoints = 720; // ~2h at 10s interval

  const RATES = [2000, 5000, 10000, 30000, 60000, 120000];
  const AUTO_STEPS = [10000, 30000, 60000, 120000];
  const nextRate = (ms) => {
    const i = RATES.indexOf(ms);
    return RATES[(i >= 0 ? i + 1 : 0) % RATES.length];
  };

  const LS_LAST_LOGIN = 'tm_charts_last_login';
  const LS_INTERVAL = 'tm_charts_interval_ms';
  const LS_SHOW_OFFLINE = 'tm_charts_show_offline';
  const LS_MODE = 'tm_charts_interval_mode';
  const LS_SHOULD_RESUME = 'tm_charts_should_resume';
  const pointsKey = (lg) => `tm_charts_points_${lg}`;
  const loadJSON = (k, d) => {
    if (typeof window === 'undefined') return d;
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch { return d; }
  };
  const saveJSON = (k, v) => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };

  const lastYRef = useRef(null);

  const normalizeLogin = (lg) => (lg || '').trim().toLowerCase();

  const tzResolved = timeZone === 'system' ? undefined : timeZone;
  const dtfTick = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, hour: '2-digit', minute: '2-digit' }), [timeZone]);
  const dtfFull = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), [timeZone]);
  const dtfShort = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }), [timeZone]);

  const sessionsKey = (lg) => `tm_charts_sessions_${lg}`;
  const sessionPointsKey = (lg, id) => `tm_charts_points_${lg}_${id}`;
  const selectedSessionKey = (lg) => `tm_charts_selected_session_${lg}`;

  function loadSessions(lg) {
    return loadJSON(sessionsKey(lg), []);
  }

  function deleteAllChannelData(lg) {
    const name = normalizeLogin(lg);
    if (!name) return;
    const sess = loadSessions(name);
    for (const s of sess) {
      try { if (typeof window !== 'undefined') localStorage.removeItem(sessionPointsKey(name, s.id)); } catch {}
    }
    try { if (typeof window !== 'undefined') localStorage.removeItem(sessionsKey(name)); } catch {}
    try { if (typeof window !== 'undefined') localStorage.removeItem(pointsKey(name)); } catch {}
    setSessions([]);
    activeSessionIdRef.current = null;
    setSelectedSessionId(null);
    setPoints([]);
  }

  function saveSessions(lg, arr) {
    saveJSON(sessionsKey(lg), arr);
  }

  function loadSessionPoints(lg, id) {
    return loadJSON(sessionPointsKey(lg, id), []);
  }

  function saveSessionPoints(lg, id, pts) {
    saveJSON(sessionPointsKey(lg, id), pts);
  }

  function migrateLegacyIfNeeded(lg) {
    const sess = loadSessions(lg);
    if (Array.isArray(sess) && sess.length) return sess;
    const legacy = loadJSON(pointsKey(lg), null);
    if (!legacy || !Array.isArray(legacy) || legacy.length === 0) return [];
    const first = legacy[0];
    const last = legacy[legacy.length - 1];
    const startMs = first && typeof first.x === 'number' ? first.x : Date.now();
    const endMs = last && typeof last.x === 'number' ? last.x : startMs;
    const id = new Date(startMs).toISOString();
    const simplePts = legacy.map(p => ({ x: p.x, y: p.y }));
    saveSessionPoints(lg, id, simplePts);
    const meta = [{ id, start: startMs, end: endMs, count: simplePts.length }];
    saveSessions(lg, meta);
    try { if (typeof window !== 'undefined') localStorage.removeItem(pointsKey(lg)); } catch {}
    return meta;
  }

  // Build list of timezones on client
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let list = [];
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        list = Intl.supportedValuesOf('timeZone');
      }

    } catch {}
    if (!list || list.length === 0) {
      list = [
        'UTC',
        'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
        'Europe/London', 'Europe/Berlin', 'Europe/Paris',
        'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata',
        'Australia/Sydney',
      ];
    }
    setTzList(list);
    const onStorage = (e) => {
      if (e.key === 'twitch_mon_settings_v1') {
        try {
          const obj = e.newValue ? JSON.parse(e.newValue) : {};
          const sel = obj && obj.selected_channel ? obj.selected_channel : '';
          if (sel && sel !== login) setLogin(sel);
        } catch {}
      }
    };
    const onFocus = () => {
      const sel = normalizeLogin(getSelectedChannel());
      if (sel && sel !== login) {
        setLogin(sel);
        // Peek immediately for the newly selected channel
        pollOnce({ peek: true, loginOverride: sel });
      } else if (login) {
        // Refresh online/offline status for current channel
        pollOnce({ peek: true });
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tzAliases = useMemo(() => ({
    PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
    MST: 'America/Denver', MDT: 'America/Denver',
    CST: 'America/Chicago', CDT: 'America/Chicago',
    EST: 'America/New_York', EDT: 'America/New_York',
    GMT: 'UTC', BST: 'Europe/London',
    CET: 'Europe/Paris', CEST: 'Europe/Paris',
    IST: 'Asia/Kolkata', JST: 'Asia/Tokyo',
    AEST: 'Australia/Sydney', AEDT: 'Australia/Sydney',
  }), []);

  const tzSuggestions = useMemo(() => {
    const q = tzInput.trim();
    if (!q) return [];
    const phrase = q.toLowerCase().replace(/[\/_]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = phrase.split(' ');
    const seen = new Set();
    const out = [];
    // Alias match
    const aliasTarget = tzAliases[q.toUpperCase()];
    if (aliasTarget) { out.push(aliasTarget); seen.add(aliasTarget); }
    for (const tz of tzList) {
      const norm = tz.toLowerCase().replace(/[\/_]/g, ' ').replace(/\s+/g, ' ').trim();
      // Prefer contiguous substring match
      let match = norm.includes(phrase);
      // Fallback to all-token containment in any order
      if (!match) {
        match = tokens.every(t => norm.includes(t));
      }
      if (!match) continue;
      if (!seen.has(tz)) { out.push(tz); seen.add(tz); }
      if (out.length >= 20) break;
    }
    return out;
  }, [tzInput, tzList, tzAliases]);

  async function pollOnce(opts) {
    const peek = !!(opts && opts.peek);
    const name = normalizeLogin(opts && opts.loginOverride ? String(opts.loginOverride) : login);
    if (!name) { setStatus('Enter a channel login'); return; }
    try {
      if (blinkTimerRef.current) { clearTimeout(blinkTimerRef.current); blinkTimerRef.current = null; }
      setBlink(true);
      console.log('[charts] fetch start', { peek, running, login: name });
      const resp = await getStreamsByLogin(name);
      const stream = resp.data?.[0] || null;
      const ts = Date.now();
      let gameName = null;
      let title = null;
      let viewers = null;
      if (stream) {
        title = stream.title || null;
        viewers = stream.viewer_count ?? null;
        console.log('[charts] stream online', { started_at: stream.started_at, viewers, title });
        if (stream.game_id) {
          try {
            const g = await getGame(stream.game_id);
            gameName = g.data?.[0]?.name || null;
          } catch {}
        }
        // Session handling (persist only if running and not peeking)
        const persist = running && !peek;
        let didAutoSelect = false;
        const startedAtISO = stream.started_at; // only create a session when Twitch provides started_at
        if (persist && startedAtISO && activeSessionIdRef.current !== startedAtISO) {
          // New live session started (or app joined mid-session)
          activeSessionIdRef.current = startedAtISO;
          let sess = loadSessions(name);
          const existing = sess.find(s => s.id === startedAtISO);
          if (!existing) {
            console.log('[charts] create session', { id: startedAtISO });
            sess.push({ id: startedAtISO, start: Date.parse(startedAtISO) || ts, end: null, count: 0 });
            saveSessions(name, sess);
            setSessions(sess);
          }
          // If UI is in an indeterminate/offline selection, auto-select live session now
          if (selectedSessionId == null || selectedSessionId === 'offline') {
            console.log('[charts] select live session', { id: startedAtISO });
            setSelectedSessionId(startedAtISO);
            didAutoSelect = true;
          }
        }
        // Append point to active session
        if (persist && activeSessionIdRef.current) {
          const id = activeSessionIdRef.current;
          const pts = loadSessionPoints(name, id);
          const last = pts[pts.length - 1];
          if (last && typeof last.x === 'number') {
            const gapMs = ts - last.x;
            if (gapMs > intervalMs * 1.5) {
              pts.push({ x: ts - 1, y: null, gap: true });
            }
          }
          pts.push({ x: ts, y: viewers });
          if (pts.length > maxPoints) pts.splice(0, pts.length - maxPoints);
          console.log('[charts] save points', { session: id, count: pts.length, lastX: pts[pts.length - 1]?.x, lastY: pts[pts.length - 1]?.y });
          saveSessionPoints(name, id, pts);
          // Update sessions meta (last, count). Do NOT set end while live.
          const sess = loadSessions(name);
          const meta = sess.find(s => s.id === id);
          if (meta) { meta.last = ts; meta.count = pts.length; saveSessions(name, sess); setSessions(sess); }
          const selId = selectedSessionIdRef.current;
          if (didAutoSelect || selId === id) {
            console.log('[charts] immediate setPoints after save', { selectedSessionId, id, didAutoSelect, count: pts.length });
            setPoints(pts.slice());
          }
        }
      } else {
        // Offline: finalize any active session (only if persisting)
        if (running && !peek && activeSessionIdRef.current) {
          const id = activeSessionIdRef.current;
          const sess = loadSessions(name);
          const meta = sess.find(s => s.id === id);
          if (meta && !meta.end) {
            console.log('[charts] finalize session', { id, end: ts });
            meta.end = ts; saveSessions(name, sess); setSessions(sess);
          }
          activeSessionIdRef.current = null;
        }
        console.log('[charts] stream offline');
      }
      const when = dtfFull.format(ts);
      setStatus(`${when} — ${name}: ${stream ? `${viewers} viewers` : 'offline'}${gameName ? ' — ' + gameName : ''}${title ? ' — ' + title : ''}`);
      blinkTimerRef.current = setTimeout(() => { setBlink(false); blinkTimerRef.current = null; }, 400);

      // Auto mode adaptation only while running
      if (running && autoMode) {
        const prevY = lastYRef.current;
        const currY = stream ? viewers : null;
        const changed = (prevY !== currY);
        lastYRef.current = currY;
        const idx = Math.max(0, AUTO_STEPS.indexOf(intervalMs));
        let nextMs = intervalMs;
        if (changed) {
          nextMs = AUTO_STEPS[0];
        } else {
          nextMs = AUTO_STEPS[Math.min(idx + 1, AUTO_STEPS.length - 1)];
        }
        if (nextMs !== intervalMs) setIntervalMs(nextMs);
      }
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
    saveJSON(LS_LAST_LOGIN, normalizeLogin(login));
    saveJSON(LS_SHOULD_RESUME, true);
  }

  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (blinkTimerRef.current) { clearTimeout(blinkTimerRef.current); blinkTimerRef.current = null; }
    setBlink(false);
    setRunning(false);
    setStatus('Stopped');
    saveJSON(LS_SHOULD_RESUME, false);
  }

  // Stop timers without changing resume flag; used on unmount
  function stopTimers() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (blinkTimerRef.current) { clearTimeout(blinkTimerRef.current); blinkTimerRef.current = null; }
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
      // Ensure initial render even before first points change
      inst.setOption({
        animation: false,
        axisPointer: {
          link: [{ xAxisIndex: [0, 1] }],
          label: { formatter: (obj) => dtfFull.format(obj.value) },
        },
        grid: [
          { left: 40, right: 16, top: 16, height: '40%', containLabel: true },
          { left: 40, right: 16, top: '63%', bottom: 40, containLabel: true },
        ],
        tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? 'offline' : String(v)) },
        xAxis: [
          { type: 'time', gridIndex: 0, axisLabel: { formatter: (val) => dtfTick.format(val) } },
          { type: 'time', gridIndex: 1, axisLabel: { formatter: (val) => dtfTick.format(val) } },
        ],
        yAxis: [
          { type: 'value', min: 0, name: 'Viewers', gridIndex: 0 },
          { type: 'value', name: 'Δ Viewers', gridIndex: 1 },
        ],
        series: [
          { type: 'line', name: 'Viewers', showSymbol: false, smooth: 0.25, areaStyle: {}, data: [], connectNulls: !showOffline, xAxisIndex: 0, yAxisIndex: 0, clip: true },
          { type: 'bar', name: 'Δ Viewers', data: [], xAxisIndex: 1, yAxisIndex: 1, barWidth: 14, clip: true },
        ],
      });
      // In case layout settles after mount, force a resize next frame
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => inst.resize());
      } else {
        setTimeout(() => inst.resize(), 0);
      }
      // Nudge points to retrigger the data update effect once chart is ready
      setTimeout(() => {
        try { setPoints(p => (Array.isArray(p) ? p.slice() : p)); } catch {}
      }, 0);
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
    const xs = points.map(p => p.x).filter(x => typeof x === 'number');
    let minX = xs.length ? Math.min(...xs) : undefined;
    let maxX = xs.length ? Math.max(...xs) : undefined;
    if (minX !== undefined && maxX !== undefined) {
      const span = maxX - minX;
      const ONE_HOUR = 60 * 60 * 1000;
      const PAD = 5 * 60 * 1000;
      if (span < ONE_HOUR) {
        minX = maxX - ONE_HOUR;
      }
      maxX = maxX + PAD;
      console.log('[charts] x-axis window', { minX, maxX, span });
    }
    console.log('[charts] setOption update', { points: points.length });
    inst.setOption({
      animation: false,
      axisPointer: {
        link: [{ xAxisIndex: [0, 1] }],
        label: { formatter: (obj) => dtfFull.format(obj.value) },
      },
      grid: [
        { left: 40, right: 16, top: 16, height: '40%', containLabel: true },
        { left: 40, right: 16, top: '63%', bottom: 40, containLabel: true },
      ],
      tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? 'offline' : String(v)) },
      xAxis: [
        { type: 'time', gridIndex: 0, axisLabel: { formatter: (val) => dtfTick.format(val) }, min: minX, max: maxX },
        { type: 'time', gridIndex: 1, axisLabel: { formatter: (val) => dtfTick.format(val) }, min: minX, max: maxX },
      ],
      yAxis: [
        { type: 'value', min: 0, name: 'Viewers', gridIndex: 0 },
        { type: 'value', name: 'Δ Viewers', gridIndex: 1 },
      ],
      series: [
        {
          type: 'line',
          name: 'Viewers',
          showSymbol: points.length <= 2,
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
    }, { notMerge: true });
    // Ensure canvas resizes correctly after updates (navigation/visibility changes)
    inst.resize();
  }, [points, showOffline, timeZone]);

  useEffect(() => () => stopTimers(), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const selected = normalizeLogin(getSelectedChannel());
    const last = normalizeLogin(loadJSON(LS_LAST_LOGIN, null));
    const initial = selected || last || '';
    setLogin(initial);
    // Load sessions and possibly migrate legacy
    const sess = migrateLegacyIfNeeded(initial);
    setSessions(sess);
    const active = sess.find(s => !s.end) || null;
    activeSessionIdRef.current = active ? active.id : null;
    // default selection: live if active else most recent finished
    const savedSel = initial ? loadJSON(selectedSessionKey(initial), null) : null;
    if (savedSel === 'offline') {
      setSelectedSessionId('offline');
    } else if (savedSel && sess.find(s => s.id === savedSel)) {
      setSelectedSessionId(savedSel);
    } else if (active) {
      setSelectedSessionId(active.id);
    } else if (sess.length) {
      setSelectedSessionId(sess[sess.length - 1].id);
    }
    const savedShow = loadJSON(LS_SHOW_OFFLINE, true);
    setShowOffline(!!savedShow);
    const savedInterval = loadJSON(LS_INTERVAL, 10000);
    setIntervalMs(savedInterval);
    const savedMode = loadJSON(LS_MODE, false);
    setAutoMode(!!savedMode);
    const savedTz = getSelectedTimeZone();
    setTimeZone(savedTz || 'system');
    setTzInput(savedTz === 'system' ? '' : savedTz);
    setTzRecents(getRecentTimeZones());
    // Auto-resume if previously running
    const shouldResume = loadJSON(LS_SHOULD_RESUME, false);
    if (shouldResume && initial) {
      // Delay start slightly to allow state to settle
      setTimeout(() => { if (!timerRef.current) start(); }, 0);
    } else if (initial) {
      // Do a non-persisting peek to decide what to show immediately
      setTimeout(() => pollOnce({ peek: true, loginOverride: initial }), 0);
    }
  }, []);

  // When the selected login changes (from Overview or storage event), reload sessions and selection
  useEffect(() => {
    if (!login) { setSessions([]); setSelectedSessionId(null); setPoints([]); return; }
    const name = normalizeLogin(login);
    const sess = migrateLegacyIfNeeded(name);
    setSessions(sess);
    const active = sess.find(s => !s.end) || null;
    activeSessionIdRef.current = active ? active.id : null;
    const savedSel = loadJSON(selectedSessionKey(name), null);
    if (savedSel === 'offline') {
      setSelectedSessionId('offline');
    } else if (savedSel && sess.find(s => s.id === savedSel)) {
      setSelectedSessionId(savedSel);
    } else if (active) {
      setSelectedSessionId(active.id);
    } else if (sess.length) {
      setSelectedSessionId(sess[sess.length - 1].id);
    } else {
      setSelectedSessionId(null);
    }
  }, [login]);

  // If we should resume and now have a login, start automatically
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!login) return;
    const shouldResume = loadJSON(LS_SHOULD_RESUME, false);
    if (shouldResume && !running && !timerRef.current) {
      start();
    }
  }, [login, running]);

  // When login changes and we are not running, do a peek to update live/offline UI immediately
  useEffect(() => {
    if (!login) return;
    if (running) return;
    pollOnce({ peek: true });
  }, [login, running]);

  // Load points when session selection changes
  useEffect(() => {
    if (!login) return;
    if (!selectedSessionId) { setPoints([]); return; }
    if (selectedSessionId === 'offline') { setPoints([]); return; }
    const name = normalizeLogin(login);
    const pts = loadSessionPoints(name, selectedSessionId);
    console.log('[charts] load points on selection', { login, selectedSessionId, count: Array.isArray(pts) ? pts.length : 0 });
    setPoints(Array.isArray(pts) ? pts.slice() : []);
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId, login]);

  // Keep ref in sync to avoid stale closure in timer poller
  useEffect(() => { selectedSessionIdRef.current = selectedSessionId; }, [selectedSessionId]);

  // When sessions list updates and no selection is set (e.g., channel offline), prefer most recent finished session
  useEffect(() => {
    if (!login) return;
    if (selectedSessionId) return;
    if (!Array.isArray(sessions) || sessions.length === 0) return;
    const activeId = activeSessionIdRef.current;
    if (activeId) { setSelectedSessionId(activeId); return; }
    const finished = sessions.filter(s => !!s.end);
    if (finished.length) {
      setSelectedSessionId(finished[finished.length - 1].id);
    }
  }, [sessions, login, selectedSessionId]);

  // Legacy points loader removed (sessions now drive loading)

  function isValidTZ(tz) {
    if (!tz || tz === 'system') return true;
    try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
  }

  function applyTz(val) {
    const v = (!val || val === 'system') ? 'system' : val;
    if (!isValidTZ(v)) return;
    setTimeZone(v);
    setTzInput(v === 'system' ? '' : v);
    setSelectedTimeZone(v);
    setTzRecents(getRecentTimeZones());
    setTzEditing(false);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    saveJSON(LS_SHOW_OFFLINE, showOffline);
  }, [showOffline]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const name = login.trim();
    if (!name) return;
  }, [login]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    saveJSON(LS_INTERVAL, intervalMs);
    if (running) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      timerRef.current = setInterval(pollOnce, intervalMs);
      // Do an immediate poll to reflect the new channel/interval
      pollOnce();
    }
  }, [intervalMs, running, login]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    saveJSON(LS_MODE, autoMode);
    // When toggling auto on, reset to first auto step
    if (autoMode) {
      if (intervalMs !== AUTO_STEPS[0]) setIntervalMs(AUTO_STEPS[0]);
    }
  }, [autoMode]);

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
            <Text>Channel: <Code>{login || '—'}</Code></Text>
            {!running ? (
              <Button onClick={start} disabled={!login}>Start</Button>
            ) : (
              <Button color="red" onClick={stop}>Stop</Button>
            )}
            {!clearConfirm ? (
              <Button variant="soft" color="red" onClick={() => setClearConfirm(true)} disabled={!login}>Clear</Button>
            ) : (
              <Flex align="center" gap="2">
                <Button color="red" onClick={() => { deleteAllChannelData(login.trim()); setClearConfirm(false); }}>Confirm clear</Button>
                <Button variant="soft" onClick={() => setClearConfirm(false)}>Cancel</Button>
              </Flex>
            )}
            <Button variant="soft" onClick={() => setIntervalMs(nextRate(intervalMs))} disabled={autoMode}>Interval: {Math.round(intervalMs/1000)}s</Button>
            <Button variant="soft" onClick={() => setAutoMode(v => !v)}>{autoMode ? 'Auto: On' : 'Auto: Off'}</Button>
            <Box style={{ width: 10, height: 10, borderRadius: 999, background: blink ? 'var(--green-9)' : 'var(--gray-6)' }} title={blink ? 'Fetching' : 'Idle'} />
            <Flex align="center" gap="2">
              <Checkbox checked={showOffline} onCheckedChange={(v) => setShowOffline(!!v)} />
              <Text>Show gaps when offline</Text>
            </Flex>
            <Separator orientation="vertical" />
            {/* Session selector */}
            <Flex align="center" gap="2" wrap="wrap">
              <Text>Session:</Text>
              <Flex gap="2" wrap="wrap">
                {(() => {
                  const nodes = [];
                  const seen = new Set();
                  const activeId = activeSessionIdRef.current;
                  const showOffline = running && !activeId;
                  if (showOffline) {
                    nodes.push(
                      <Button key="__offline__" variant={selectedSessionId==='offline' ? 'solid' : 'soft'} onClick={() => setSelectedSessionId('offline')}>OFFLINE</Button>
                    );
                  }
                  const activeMeta = sessions.find(s => s.id === activeId);
                  if (activeMeta && !seen.has(activeMeta.id)) { nodes.push(
                    <Button key={activeMeta.id} variant={selectedSessionId===activeMeta.id ? 'solid' : 'soft'} onClick={() => setSelectedSessionId(activeMeta.id)}>
                      {dtfShort.format(activeMeta.start)}{(activeMeta.id === activeId && running) ? ': LIVE' : ''}
                    </Button>
                  ); seen.add(activeMeta.id); }
                  const finished = sessions.filter(s => !!s.end && s.id !== activeId).slice(-5).reverse();
                  for (const s of finished) {
                    if (!seen.has(s.id)) {
                      nodes.push(
                        <Button key={s.id} variant={selectedSessionId===s.id ? 'solid' : 'soft'} onClick={() => setSelectedSessionId(s.id)}>
                          {dtfShort.format(s.start)}
                        </Button>
                      );
                      seen.add(s.id);
                    }
                  }
                  return nodes;
                })()}
              </Flex>
            </Flex>
            <Separator orientation="vertical" />
            {!tzEditing ? (
              <Flex align="center" gap="2" wrap="wrap">
                <Text>Timezone:</Text>
                <Code>{timeZone === 'system' ? 'System' : timeZone}</Code>
                <Button variant="soft" onClick={() => setTzEditing(true)}>Change</Button>
              </Flex>
            ) : (
              <Box style={{ width: '100%' }}>
                <Flex align="center" gap="2" wrap="wrap">
                  <Text>Timezone:</Text>
                  <Button variant={timeZone==='system' ? 'solid' : 'soft'} onClick={() => applyTz('system')}>System</Button>
                  <Button variant={timeZone==='UTC' ? 'solid' : 'soft'} onClick={() => applyTz('UTC')}>UTC</Button>
                  <TextField.Root value={tzInput} onChange={e => setTzInput(e.target.value)} placeholder="e.g. Los Angeles, PST, Europe/Paris" />
                  <Button variant="soft" onClick={() => applyTz(tzInput.trim())}>Set TZ</Button>
                  <Button variant="soft" color="gray" onClick={() => setTzEditing(false)}>Cancel</Button>
                </Flex>
                {(tzRecents && tzRecents.length > 0) && (
                  <Flex mt="2" gap="2" wrap="wrap">
                    {tzRecents.map((z) => (
                      <Button key={z} variant="soft" onClick={() => applyTz(z)}>{z}</Button>
                    ))}
                  </Flex>
                )}
                {tzSuggestions.length > 0 && (
                  <Box style={{ marginTop: 6, border: '1px solid var(--gray-6)', borderRadius: 6, padding: 6, maxHeight: 180, overflow: 'auto' }}>
                    <Flex gap="2" wrap="wrap">
                      {tzSuggestions.map((z) => (
                        <Button key={z} variant="soft" onClick={() => applyTz(z)}>{z}</Button>
                      ))}
                    </Flex>
                  </Box>
                )}
              </Box>
            )}
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
