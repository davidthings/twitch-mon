import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Heading, Text, Card, Flex, Button, Separator, Code, TextField } from '@radix-ui/themes';
import { getSelectedTimeZone, setSelectedTimeZone, getRecentTimeZones, getSelectedChannel } from '../lib/settings';
import { useAuth } from '../lib/useAuth';
import { getUsersByLogin, getChatters, getStreamsByLogin } from '../lib/helix';

export default function ChattersChart() {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const [timeZone, setTimeZone] = useState('system');
  const [tzInput, setTzInput] = useState('');
  const [tzRecents, setTzRecents] = useState([]);
  const [tzList, setTzList] = useState([]);
  const [tzEditing, setTzEditing] = useState(false);
  const { authed, user } = useAuth();
  const [login, setLogin] = useState('');
  const [broadcasterId, setBroadcasterId] = useState(null);
  const [rows, setRows] = useState([]);
  const rowsRef = useRef([]);
  const segmentsRef = useRef(new Map());
  const namesRef = useRef(new Map());
  const pollRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const activeSessionIdRef = useRef(null);
  const [isLive, setIsLive] = useState(false);
  const [pollInfo, setPollInfo] = useState({ at: null, count: 0, error: '' });
  const [showDebug, setShowDebug] = useState(false);
  const [debugObj, setDebugObj] = useState(null);

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
  }, []);

  // Keep a live reference to the current rows
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  useEffect(() => {
    if (!broadcasterId || !user) return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    let disposed = false;
    async function pollOnce() {
      try {
        const present = new Map();
        let after = undefined;
        let pages = 0;
        do {
          const resp = await getChatters(broadcasterId, user.id, after);
          const data = resp && resp.data ? resp.data : [];
          for (const c of data) {
            present.set(c.user_login, c);
            if (!namesRef.current.has(c.user_login)) namesRef.current.set(c.user_login, c.user_name || c.user_login);
          }
          after = resp && resp.pagination && resp.pagination.cursor;
          pages += 1;
          if (pages > 10) break;
        } while (after);
        const now = Date.now();
        const segs = segmentsRef.current;
        for (const [loginKey, list] of segs.entries()) {
          const isHere = present.has(loginKey);
          if (!isHere) {
            const last = list[list.length - 1];
            if (last && last.end == null) last.end = now;
          }
        }
        let nextRows = (rowsRef.current || []).slice();
        for (const [loginKey, info] of present.entries()) {
          if (!segs.has(loginKey)) segs.set(loginKey, []);
          const arr = segs.get(loginKey);
          const last = arr[arr.length - 1];
          if (!last || last.end != null) {
            arr.push({ start: now, end: null });
          }
          if (!nextRows.includes(loginKey)) nextRows.push(loginKey);
        }
        const presentSet = new Set(present.keys());
        nextRows.sort((a, b) => {
          const aHere = presentSet.has(a), bHere = presentSet.has(b);
          if (aHere !== bHere) return aHere ? -1 : 1;
          return a.localeCompare(b);
        });
        if (!disposed) {
          // Only update rows if the order or length changed
          const prev = rowsRef.current || [];
          let changed = nextRows.length !== prev.length;
          if (!changed) {
            for (let i = 0; i < nextRows.length; i++) { if (nextRows[i] !== prev[i]) { changed = true; break; } }
          }
          if (changed) setRows(nextRows);
          setTick(t => t + 1);
          const name = (login||'').trim();
          if (name) {
            const existing = loadJSON(presenceAllKeyNorm(name), loadJSON(presenceAllKeyLegacy(name), null));
            const base = (existing && existing.users) ? { users: { ...existing.users } } : { users: {} };
            // Overwrite with latest in-memory segments for currently tracked users
            for (const [k, arr] of segmentsRef.current.entries()) {
              base.users[k] = { name: (namesRef.current.get(k) || (existing && existing.users && existing.users[k] && existing.users[k].name) || k), intervals: arr.map(s => ({ start: s.start, end: s.end == null ? null : s.end })) };
            }
            saveJSON(presenceAllKeyNorm(name), base);
            setDebugObj(base);
          }
          setPollInfo({ at: Date.now(), count: present.size, error: '' });
        }
      } catch (e) {
        if (!disposed) setPollInfo({ at: Date.now(), count: 0, error: (e && e.message) ? String(e.message) : 'poll failed' });
      }
    }
    pollOnce();
    pollRef.current = setInterval(pollOnce, 5000);
    return () => { disposed = true; if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [broadcasterId, user, login]);

  useEffect(() => {
    const name = (login||'').trim();
    if (name) {
      let obj = loadJSON(presenceAllKeyNorm(name), null);
      if (!obj) {
        const legacy = loadJSON(presenceAllKeyLegacy(name), null);
        if (legacy) { obj = legacy; saveJSON(presenceAllKeyNorm(name), legacy); }
      }
      const segs = new Map();
      const labels = new Map();
      const r = [];
      if (obj && obj.users) {
        for (const k of Object.keys(obj.users)) {
          const u = obj.users[k];
          labels.set(k, u.name || k);
          segs.set(k, u.intervals.map(it => ({ start: it.start, end: it.end == null ? null : it.end })));
          r.push(k);
        }
      }
      namesRef.current = labels;
      segmentsRef.current = segs;
      setRows(r);
      setTick(t => t + 1);
      if (obj) setDebugObj(obj);
    }
  }, [login]);

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
    const aliasTarget = tzAliases[q.toUpperCase()];
    if (aliasTarget) { out.push(aliasTarget); seen.add(aliasTarget); }
    for (const tz of tzList) {
      const norm = tz.toLowerCase().replace(/[\/_]/g, ' ').replace(/\s+/g, ' ').trim();
      let match = norm.includes(phrase);
      if (!match) match = tokens.every(t => norm.includes(t));
      if (!match) continue;
      if (!seen.has(tz)) { out.push(tz); seen.add(tz); }
      if (out.length >= 20) break;
    }
    return out;
  }, [tzInput, tzList, tzAliases]);

  const resultKey = (lg) => `tm_chatters_result_${(lg || '').trim()}`;
  const LS_LAST_LOGIN = 'tm_chatters_last_login';
  const loadJSON = (k, d) => {
    if (typeof window === 'undefined') return d;
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch { return d; }
  };
  const saveJSON = (k, v) => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };
  const sessionsKey = (lg) => `tm_charts_sessions_${(lg||'').trim()}`;
  const selectedSessionKey = (lg) => `tm_charts_selected_session_${(lg||'').trim()}`;
  const presenceKey = (lg, id) => `tm_chatters_presence_${(lg||'').trim()}_${id}`;
  const presenceAllKeyLegacy = (lg) => `tm_chatters_presence_${(lg||'').trim()}`;
  const presenceAllKeyNorm = (lg) => `tm_chatters_presence_${(lg||'').trim().toLowerCase()}`;

  const tzResolved = timeZone === 'system' ? undefined : timeZone;
  const dtfTick = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, hour: '2-digit', minute: '2-digit' }), [timeZone]);
  const dtfFull = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), [timeZone]);
  const dtfShort = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }), [timeZone]);

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
    const savedTz = getSelectedTimeZone();
    setTimeZone(savedTz || 'system');
    setTzInput(savedTz === 'system' ? '' : savedTz);
    setTzRecents(getRecentTimeZones());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lg = getSelectedChannel();
    if (!lg) {
      const last = loadJSON(LS_LAST_LOGIN, null);
      if (last) lg = last;
    }
    setLogin(lg || '');
    if (lg) {
      const sess = loadJSON(sessionsKey(lg), []);
      setSessions(Array.isArray(sess) ? sess : []);
      const saved = loadJSON(resultKey(lg), null);
      if (saved && Array.isArray(saved.chatters) && saved.chatters.length > 0) {
        const unique = [];
        const seen = new Set();
        for (const c of saved.chatters) { if (!seen.has(c.user_login)) { unique.push(c.user_login); seen.add(c.user_login); namesRef.current.set(c.user_login, c.user_name || c.user_login); } }
        setRows(unique);
      }
      const selSaved = loadJSON(selectedSessionKey(lg), null);
      if (selSaved) setSelectedSessionId(selSaved);
      // Migrate any per-session presence keys to continuous key if needed
      let cont = loadJSON(presenceAllKeyNorm(lg), null);
      if (!cont) {
        const legacy = loadJSON(presenceAllKeyLegacy(lg), null);
        if (legacy) { cont = legacy; saveJSON(presenceAllKeyNorm(lg), legacy); }
      }
      if (!cont && Array.isArray(sess) && sess.length > 0) {
        const merged = { users: {} };
        for (const s of sess) {
          const per = loadJSON(presenceKey(lg, s.id), null);
          if (!per || !per.users) continue;
          for (const k of Object.keys(per.users)) {
            const u = per.users[k];
            if (!merged.users[k]) merged.users[k] = { name: (u && u.name) || k, intervals: [] };
            const src = Array.isArray(u && u.intervals) ? u.intervals : [];
            merged.users[k].intervals.push(...src.map(it => ({ start: it.start, end: it.end == null ? null : it.end })));
          }
        }
        // Optional: sort and coalesce intervals per user
        for (const k of Object.keys(merged.users)) {
          const arr = merged.users[k].intervals.filter(it => typeof it.start === 'number');
          arr.sort((a,b) => a.start - b.start);
          const out = [];
          for (const it of arr) {
            const last = out[out.length - 1];
            if (!last) { out.push({ start: it.start, end: it.end == null ? null : it.end }); continue; }
            const lastEnd = last.end == null ? Infinity : last.end;
            const curEnd = it.end == null ? Infinity : it.end;
            if (it.start <= lastEnd) {
              // merge overlap/adjacent
              last.end = Math.max(lastEnd, curEnd);
              if (!isFinite(last.end)) last.end = null;
            } else {
              out.push({ start: it.start, end: it.end == null ? null : it.end });
            }
          }
          merged.users[k].intervals = out;
        }
        saveJSON(presenceAllKeyNorm(lg), merged);
      }
    }
  }, []);

  //

  // remove single-user auto-pick; we track all users now

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      const name = (login || '').trim();
      if (!name) { setBroadcasterId(null); return; }
      try {
        const u = await getUsersByLogin(name);
        const b = u && u.data && u.data[0];
        if (!cancelled) setBroadcasterId(b ? b.id : null);
      } catch {
        if (!cancelled) setBroadcasterId(null);
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, [login]);

  useEffect(() => {
    if (!login) return;
    let disposed = false;
    async function pollStream() {
      try {
        const name = (login||'').trim();
        if (!name) return;
        const resp = await getStreamsByLogin(name);
        const stream = resp && resp.data && resp.data[0] ? resp.data[0] : null;
        const ts = Date.now();
        if (stream && stream.started_at) {
          setIsLive(true);
          const id = stream.started_at;
          if (activeSessionIdRef.current !== id) {
            activeSessionIdRef.current = id;
            let sess = loadJSON(sessionsKey(name), []);
            if (!Array.isArray(sess)) sess = [];
            if (!sess.find(s => s.id === id)) {
              const startMs = Date.parse(stream.started_at) || ts;
              sess.push({ id, start: startMs, end: null, count: 0 });
              saveJSON(sessionsKey(name), sess);
            }
            setSessions(sess);
            const sel = loadJSON(selectedSessionKey(name), null);
            if (sel == null || sel === 'offline') setSelectedSessionId(id);
          }
        } else {
          setIsLive(false);
          const id = activeSessionIdRef.current;
          if (id) {
            let sess = loadJSON(sessionsKey(name), []);
            const meta = Array.isArray(sess) ? sess.find(s => s.id === id) : null;
            if (meta && !meta.end) { meta.end = ts; saveJSON(sessionsKey(name), sess); setSessions(sess); }
            activeSessionIdRef.current = null;
          }
        }
      } catch {}
    }
    const t = setInterval(pollStream, 10000);
    pollStream();
    return () => clearInterval(t);
  }, [login]);
  // Initialize chart once, windowed by selected session (view only)
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

      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;
      const PRE_PAD = 30 * 60 * 1000;
      const LIVE_PAD = 5 * 60 * 1000;
      const FINISHED_PAD = 30 * 60 * 1000;
      let minX = now - ONE_HOUR;
      let maxX = now + LIVE_PAD;
      if (selectedSessionId && selectedSessionId !== 'offline' && Array.isArray(sessions)) {
        const activeId = activeSessionIdRef.current;
        const meta = sessions.find(s => s.id === selectedSessionId) || (activeId ? sessions.find(s => s.id === activeId) : null);
        if (meta) {
          const start = typeof meta.start === 'number' ? meta.start : (Date.parse(meta.id) || now);
          const end = meta.end || null;
          minX = start - PRE_PAD;
          maxX = end ? (end + FINISHED_PAD) : (now + LIVE_PAD);
        }
      }

      inst.setOption({
        animation: false,
        grid: [{ left: 40, right: 16, top: 16, bottom: 40, containLabel: true }],
        axisPointer: { label: { formatter: (obj) => {
          const raw = obj && obj.value;
          const val = Array.isArray(raw) ? raw[0] : raw;
          if (typeof val === 'number' && isFinite(val)) return dtfFull.format(val);
          if (typeof val === 'string') {
            const t = Date.parse(val);
            if (!Number.isNaN(t)) return dtfFull.format(t);
          }
          return String(val ?? '');
        } } },
        tooltip: { trigger: 'item', formatter: (p) => {
          const d = p && p.data;
          const loginKey = d && d.login;
          const uname = (loginKey && namesRef.current.get(loginKey)) || loginKey || '';
          const s = d ? d.value[0] : null;
          const e = d ? d.value[1] : null;
          const sStr = (typeof s === 'number') ? dtfFull.format(s) : '';
          const eStr = (typeof e === 'number') ? dtfFull.format(e) : '';
          return `${uname} (${loginKey})<br/>${sStr} → ${eStr || 'now'}`;
        } },
        xAxis: [{ type: 'time', min: minX, max: maxX, axisLabel: { formatter: (val) => dtfTick.format(val) } }],
        yAxis: [{ type: 'value', min: -0.5, max: 0.5, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }, name: 'People' }],
        series: [
          {
            type: 'custom',
            name: 'Presence',
            coordinateSystem: 'cartesian2d',
            renderItem: function (params, api) {
              const start = api.value(0);
              const end = api.value(1);
              const row = api.value(2);
              const x0 = api.coord([start, row])[0];
              const x1 = api.coord([end, row])[0];
              const y = api.coord([start, row])[1];
              const band = api.size([0, 1])[1];
              const h = Math.max(2, band * 0.6);
              const left = Math.min(x0, x1);
              const width = Math.max(1, Math.abs(x1 - x0));
              return { type: 'rect', shape: { x: left, y: y - h / 2, width: width, height: h }, style: api.style({ fill: '#4f46e5' }) };
            },
            universalTransition: true,
            clip: true,
            dimensions: ['start', 'end', 'row'],
            encode: { x: [0, 1], y: 2 },
            data: [],
          }
        ],
      });
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => inst.resize());
      } else {
        setTimeout(() => inst.resize(), 0);
      }
      return () => { window.removeEventListener('resize', handleResize); inst.dispose(); };
    }
    const cleanup = init();
    return () => { disposed = true; Promise.resolve(cleanup).then(fn => fn && fn()); };
  }, []);
  // Update x-axis window when TZ/session/live state changes
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const PRE_PAD = 30 * 60 * 1000;
    const LIVE_PAD = 5 * 60 * 1000;
    const FINISHED_PAD = 30 * 60 * 1000;
    let minX = now - ONE_HOUR;
    let maxX = now + LIVE_PAD;
    if (selectedSessionId && selectedSessionId !== 'offline' && Array.isArray(sessions)) {
      const activeId = activeSessionIdRef.current;
      const meta = sessions.find(s => s.id === selectedSessionId) || (activeId ? sessions.find(s => s.id === activeId) : null);
      if (meta) {
        const start = typeof meta.start === 'number' ? meta.start : (Date.parse(meta.id) || now);
        const end = meta.end || null;
        minX = start - PRE_PAD;
        maxX = end ? (end + FINISHED_PAD) : (now + LIVE_PAD);
      }
    }
    inst.setOption({
      axisPointer: { label: { formatter: (obj) => {
        const raw = obj && obj.value;
        const val = Array.isArray(raw) ? raw[0] : raw;
        if (typeof val === 'number' && isFinite(val)) return dtfFull.format(val);
        if (typeof val === 'string') { const t = Date.parse(val); if (!Number.isNaN(t)) return dtfFull.format(t); }
        return String(val ?? '');
      } } },
      xAxis: [{ type: 'time', min: minX, max: maxX, axisLabel: { formatter: (val) => dtfTick.format(val) } }],
    }, { notMerge: false });
    inst.resize();
  }, [timeZone, selectedSessionId, sessions, isLive, tick]);

  // Update series data when rows or segments change
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    const now = Date.now();
    const dataArr = [];
    const segs = segmentsRef.current;
    for (let i = 0; i < rows.length; i++) {
      const loginKey = rows[i];
      const arr = segs.get(loginKey) || [];
      for (let idx = 0; idx < arr.length; idx++) {
        const seg = arr[idx];
        dataArr.push({ id: `${loginKey}__${idx}`, value: [seg.start, (seg.end == null ? now : seg.end), i], login: loginKey });
      }
    }
    inst.setOption({
      yAxis: [{ type: 'value', min: -0.5, max: rows.length - 0.5, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }, name: 'People' }],
      series: [
        {
          type: 'custom',
          name: 'Presence',
          coordinateSystem: 'cartesian2d',
          renderItem: function (params, api) {
            const start = api.value(0);
            const end = api.value(1);
            const row = api.value(2);
            const x0 = api.coord([start, row])[0];
            const x1 = api.coord([end, row])[0];
            const y = api.coord([start, row])[1];
            const band = api.size([0, 1])[1];
            const h = Math.max(2, band * 0.6);
            const left = Math.min(x0, x1);
            const width = Math.max(8, Math.abs(x1 - x0));
            return { type: 'rect', shape: { x: left, y: y - h / 2, width: width, height: h }, style: api.style({ fill: '#4f46e5' }) };
          },
          universalTransition: true,
          clip: true,
          dimensions: ['start', 'end', 'row'],
          encode: { x: [0, 1], y: 2 },
          data: dataArr,
        }
      ]
    }, { notMerge: false });
    inst.resize();
  }, [rows, tick]);

  useEffect(() => {
    if (!login) return;
    if (selectedSessionId) return;
    if (!Array.isArray(sessions) || sessions.length === 0) return;
    const activeId = activeSessionIdRef.current;
    if (activeId) { setSelectedSessionId(activeId); return; }
    const finished = sessions.filter(s => !!s.end);
    if (finished.length) setSelectedSessionId(finished[finished.length - 1].id);
  }, [sessions, login, selectedSessionId]);

  return (
    <Card>
      <Heading size="5">Chatters Timeline — {rows.length} users</Heading>
      {pollInfo.error && (<Text color="red" as="p">Polling error: <Code>{pollInfo.error}</Code></Text>)}
      {!pollInfo.error && pollInfo.at && (<Text color="gray" as="p">Last poll: {dtfFull.format(pollInfo.at)} — present: {pollInfo.count}</Text>)}
      <Separator my="3" />
      <Flex align="center" gap="2" wrap="wrap">
        {!tzEditing ? (
          <Flex align="center" gap="2" wrap="wrap">
            <Text>Timezone:</Text>
            <Code>{timeZone === 'system' ? 'System' : timeZone}</Code>
            <Button variant="soft" onClick={() => setTzEditing(true)}>Change</Button>
            <Button variant={showDebug ? 'solid' : 'soft'} color="gray" onClick={() => setShowDebug(v => !v)}>Debug</Button>
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
      {showDebug && debugObj && (
        <Box mt="2" style={{ border: '1px solid var(--gray-6)', borderRadius: 6, padding: 6, maxHeight: 240, overflow: 'auto', background: 'var(--gray-2)' }}>
          <Text as="div" color="gray" mb="1">Presence snapshot (saved each poll)</Text>
          <pre style={{ margin: 0, fontSize: 12 }}>
{JSON.stringify(debugObj, null, 2)}
          </pre>
        </Box>
      )}
      <Separator my="3" />
      <Flex align="center" gap="2" wrap="wrap">
        <Text>Session:</Text>
        <Flex gap="2" wrap="wrap">
          {(() => {
            const nodes = [];
            const activeId = activeSessionIdRef.current;
            const showOffline = !isLive;
            if (showOffline) {
              nodes.push(
                <Button key="__offline__" variant={selectedSessionId==='offline' ? 'solid' : 'soft'} onClick={() => setSelectedSessionId('offline')}>OFFLINE</Button>
              );
            }
            const activeMeta = sessions.find(s => s.id === activeId);
            if (activeMeta) {
              nodes.push(
                <Button key={activeMeta.id} variant={selectedSessionId===activeMeta.id ? 'solid' : 'soft'} onClick={() => setSelectedSessionId(activeMeta.id)}>
                  {dtfShort.format(activeMeta.start)}{(activeMeta.id === activeId && isLive) ? ': LIVE' : ''}
                </Button>
              );
            }
            const finished = sessions.filter(s => !!s.end && s.id !== activeId).slice(-5).reverse();
            for (const s of finished) {
              nodes.push(
                <Button key={s.id} variant={selectedSessionId===s.id ? 'solid' : 'soft'} onClick={() => setSelectedSessionId(s.id)}>
                  {dtfShort.format(s.start)}
                </Button>
              );
            }
            return nodes;
          })()}
        </Flex>
      </Flex>
      <Box mt="3" style={{ height: 420 }}>
        <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
      </Box>
    </Card>
  );
}
