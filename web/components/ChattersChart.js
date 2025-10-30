import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Heading, Text, Card, Flex, Button, Separator, Code, TextField } from '@radix-ui/themes';
import { getSelectedTimeZone, setSelectedTimeZone, getRecentTimeZones, getSelectedChannel } from '../lib/settings';
import { useAuth } from '../lib/useAuth';
import { getUsersByLogin, getChatters, getStreamsByLogin } from '../lib/helix';

export default function ChattersChart() {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const flowChartRef = useRef(null);
  const flowChartInstance = useRef(null);

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
  const [filterMode, setFilterMode] = useState('all');
  const [visRows, setVisRows] = useState([]);
  const [flowPoints, setFlowPoints] = useState([]);
  const [fitMode, setFitMode] = useState(false);
  const [pinRight, setPinRight] = useState(false);
  const [winStart, setWinStart] = useState(null);
  const [winEnd, setWinEnd] = useState(null);
  const [nowMarkTs, setNowMarkTs] = useState(() => Date.now());
  const zoomLockRef = useRef(false);
  const [chartReady, setChartReady] = useState(false);
  const lastFullRef = useRef({ min: null, max: null });
  const lastSelRef = useRef({ start: null, end: null });

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
  // Initialize flow chart once
  useEffect(() => {
    let disposed = false;
    async function init() {
      const echarts = await import('echarts');
      if (disposed) return;
      const el = flowChartRef.current;
      if (!el) return;
      const inst = echarts.init(el);
      flowChartInstance.current = inst;
      const handleResize = () => inst.resize();
      window.addEventListener('resize', handleResize);
      const now = Date.now();
      const LIVE_PAD = 5 * 60 * 1000;
      const minX = now - OFFLINE_WINDOW_MS;
      const maxX = now + LIVE_PAD;
      inst.setOption({
        animation: false,
        grid: [{ left: 40, right: 16, top: 8, bottom: 30, containLabel: true }],
        tooltip: {
          trigger: 'item',
          formatter: (params) => {
            try {
              const p = Array.isArray(params) ? params[0] : params;
              const t = (p && p.data && p.data.value && p.data.value[0]) || null;
              const ins = (p && p.data && p.data.ins) || [];
              const outs = (p && p.data && p.data.outs) || [];
              const inc = ins.length || Math.max(0, (p && p.data && p.data.value && p.data.value[1]) || 0);
              const outc = outs.length || Math.max(0, Math.abs((p && p.data && p.data.value && p.data.value[1]) || 0));
              const net = inc - outc;
              const when = (typeof t === 'number' && isFinite(t)) ? dtfFull.format(t) : '';
              const MAXN = 5;
              const fmtList = (arr) => {
                if (!arr || arr.length === 0) return '—';
                const head = arr.slice(0, MAXN);
                return head.join(', ') + (arr.length > MAXN ? ', …' : '');
              };
              const insStr = fmtList(ins);
              const outsStr = fmtList(outs);
              // If hovering one bar, still show both counts if names available
              return `${when}<br/>+${inc} in, -${outc} out (net ${net >= 0 ? '+' : ''}${net})<br/>In: ${insStr}<br/>Out: ${outsStr}`;
            } catch {
              return ' '; // ensure tooltip shows
            }
          }
        },
        xAxis: [{ type: 'time', min: minX, max: maxX, axisLabel: { formatter: (val) => dtfTick.format(val) } }],
        yAxis: [{ type: 'value', min: 'dataMin', max: 'dataMax', name: 'Flow' }],
        series: [
          { type: 'bar', name: 'Arrivals', barWidth: 14, itemStyle: { color: '#10b981' }, data: [] },
          { type: 'bar', name: 'Departures', barWidth: 14, itemStyle: { color: '#ef4444' }, data: [] },
        ],
      });
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => inst.resize());
      } else {
        setTimeout(() => inst.resize(), 0);
      }
      setChartReady(true);
      return () => { window.removeEventListener('resize', handleResize); inst.dispose(); setChartReady(false); };
    }
    const cleanup = init();
    return () => { disposed = true; Promise.resolve(cleanup).then(fn => fn && fn()); };
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
        let arrivals = 0, departures = 0;
        const arrivers = [];
        const leavers = [];
        const segs = segmentsRef.current;
        for (const [loginKey, list] of segs.entries()) {
          const isHere = present.has(loginKey);
          if (!isHere) {
            const last = list[list.length - 1];
            if (last && last.end == null) { last.end = now; departures += 1; leavers.push(loginKey); }
          }
        }
        let nextRows = (rowsRef.current || []).slice();
        for (const [loginKey, info] of present.entries()) {
          if (!segs.has(loginKey)) segs.set(loginKey, []);
          const arr = segs.get(loginKey);
          const last = arr[arr.length - 1];
          if (!last || last.end != null) {
            arr.push({ start: now, end: null });
            arrivals += 1;
            arrivers.push(loginKey);
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
            // Persist flow points with names
            const ins = arrivers.map(k => namesRef.current.get(k) || k);
            const outs = leavers.map(k => namesRef.current.get(k) || k);
            const pt = { t: now, in: arrivals, out: departures, ins, outs };
            setFlowPoints(prev => {
              const next = Array.isArray(prev) ? prev.slice() : [];
              next.push(pt);
              while (next.length > 5000) next.shift();
              return next;
            });
            const flow = loadJSON(flowKeyNorm(name), []);
            const nextFlow = Array.isArray(flow) ? flow.slice() : [];
            nextFlow.push(pt);
            while (nextFlow.length > 5000) nextFlow.shift();
            saveJSON(flowKeyNorm(name), nextFlow);
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
    const now = Date.now();
    const segs = segmentsRef.current;
    const stats = [];
    // Determine current window for filtering
    let wStart = winStart, wEnd = winEnd;
    const inst = chartInstance.current;
    if (inst && (wStart == null || wEnd == null)) {
      const opt = inst.getOption();
      const xa = opt && opt.xAxis && opt.xAxis[0] || {};
      if (typeof xa.min === 'number' && typeof xa.max === 'number') { wStart = xa.min; wEnd = xa.max; }
    }
    for (const loginKey of rows) {
      const arr = segs.get(loginKey) || [];
      // Filter out users that don't intersect the window if we have one
      if (typeof wStart === 'number' && typeof wEnd === 'number') {
        let intersects = false;
        for (const seg of arr) {
          const e = seg.end == null ? now : seg.end;
          if (seg.start <= wEnd && e >= wStart) { intersects = true; break; }
        }
        if (!intersects) continue;
      }
      const last = arr[arr.length - 1];
      const present = !!(last && last.end == null);
      const currentStart = present ? last.start : null;
      const currentDur = present && typeof currentStart === 'number' ? (now - currentStart) : 0;
      let lastVisit = -Infinity;
      if (arr.length > 0) {
        const l = arr[arr.length - 1];
        lastVisit = (l.end == null) ? l.start : l.end;
      }
      stats.push({ login: loginKey, present, currentDur, lastVisit });
    }
    const presentStats = stats.filter(s => s.present).sort((a, b) => {
      if (b.currentDur !== a.currentDur) return b.currentDur - a.currentDur; // longest duration first
      if (b.lastVisit !== a.lastVisit) return b.lastVisit - a.lastVisit;     // latest visit first
      return a.login.localeCompare(b.login);
    });
    const notPresentStats = stats.filter(s => !s.present).sort((a, b) => {
      if (b.lastVisit !== a.lastVisit) return b.lastVisit - a.lastVisit;     // latest visit first
      return a.login.localeCompare(b.login);
    });
    const list = (filterMode === 'present') ? presentStats : [...presentStats, ...notPresentStats];
    setVisRows(list.map(x => x.login));
  }, [rows, tick, filterMode, winStart, winEnd]);

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
      const flowSaved = loadJSON(flowKeyNorm(name), []);
      setFlowPoints(Array.isArray(flowSaved) ? flowSaved : []);
      const savedFit = loadJSON(fitKeyNorm(name), null);
      setFitMode(!!savedFit);
      const savedWin = loadJSON(windowKeyNorm(name), null);
      if (savedWin && typeof savedWin.start === 'number' && typeof savedWin.end === 'number' && savedWin.end > savedWin.start) {
        setWinStart(savedWin.start);
        setWinEnd(savedWin.end);
      } else {
        const now = Date.now();
        setWinStart(now - 60 * 60 * 1000); // default 1h on first run when not fit
        setWinEnd(now);
      }
    }
  }, [login]);

  // Throttle 'now' mark line updates (every ~10s)
  useEffect(() => {
    const t = setInterval(() => setNowMarkTs(Date.now()), 10000);
    return () => clearInterval(t);
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
  const flowKeyNorm = (lg) => `tm_chatters_flow_${(lg||'').trim().toLowerCase()}`;
  const fitKeyNorm = (lg) => `tm_chatters_fit_mode_${(lg||'').trim().toLowerCase()}`;
  const windowKeyNorm = (lg) => `tm_chatters_window_${(lg||'').trim().toLowerCase()}`;

  const tzResolved = timeZone === 'system' ? undefined : timeZone;
  const dtfTick = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, hour: '2-digit', minute: '2-digit' }), [timeZone]);
  const dtfFull = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), [timeZone]);
  const dtfShort = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }), [timeZone]);

  // Offline default window length
  const OFFLINE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours

  // Helpers to compute data extents and whether a window has any intervals
  function getDataExtent() {
    const segs = segmentsRef.current;
    if (!segs || segs.size === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    const now = nowMarkTs;
    for (const arr of segs.values()) {
      for (const seg of arr) {
        if (typeof seg.start !== 'number') continue;
        const e = (seg.end == null) ? now : seg.end;
        if (seg.start < min) min = seg.start;
        if (e > max) max = e;
      }
    }
    if (!isFinite(min) || !isFinite(max)) return null;
    return { min, max };
  }

  function windowHasData(minX, maxX) {
    const segs = segmentsRef.current;
    if (!segs || segs.size === 0) return false;
    const now = nowMarkTs;
    for (const arr of segs.values()) {
      for (const seg of arr) {
        if (typeof seg.start !== 'number') continue;
        const e = (seg.end == null) ? now : seg.end;
        if (seg.start <= maxX && e >= minX) return true;
      }
    }
    return false;
  }

  function fitToData() {
    const inst = chartInstance.current;
    if (!inst) return;
    const ext = getDataExtent();
    if (!ext) return;
    const PRE_PAD = 30 * 60 * 1000;
    const LIVE_PAD = 5 * 60 * 1000;
    const minX = ext.min - PRE_PAD;
    const maxX = ext.max + LIVE_PAD;
    inst.setOption({ xAxis: [{ type: 'time', min: minX, max: maxX, axisLabel: { formatter: (val) => dtfTick.format(val) } }] }, { notMerge: false });
    inst.resize();
  }

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
      let minX = now - OFFLINE_WINDOW_MS;
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
          const endTs = (typeof e === 'number' ? e : Date.now());
          const startTs = (typeof s === 'number' ? s : endTs);
          let dur = Math.max(0, endTs - startTs);
          const totalSec = Math.floor(dur / 1000);
          const h = Math.floor(totalSec / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const sec = totalSec % 60;
          const durStr = h > 0 ? `${h}h ${m}m ${sec}s` : (m > 0 ? `${m}m ${sec}s` : `${sec}s`);
          return `${uname} (${loginKey})<br/>${sStr} → ${eStr || 'now'}<br/>duration: ${durStr}`;
        } },
        xAxis: [{ type: 'time', min: minX, max: maxX, axisLabel: { formatter: (val) => dtfTick.format(val) } }],
        yAxis: [{ type: 'value', min: -0.5, max: 0.5, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }, name: 'People' }],
        dataZoom: [
          {
            type: 'slider',
            show: true,
            xAxisIndex: 0,
            filterMode: 'none',
            throttle: 100,
            height: 24,
            bottom: 4,
            brushSelect: false,
            startValue: minX,
            endValue: maxX,
          }
        ],
        series: [
          {
            type: 'custom',
            name: 'Presence',
            coordinateSystem: 'cartesian2d',
            renderItem: function (params, api) {
              const start = api.value(0);
              const end = api.value(1);
              const row = api.value(2);
              const present = api.value(3) === 1;
              const x0 = api.coord([start, row])[0];
              const x1 = api.coord([end, row])[0];
              const y = api.coord([start, row])[1];
              const band = api.size([0, 1])[1];
              const h = Math.max(2, band * 0.6);
              const left = Math.min(x0, x1);
              const width = Math.max(1, Math.abs(x1 - x0));
              const fill = (filterMode === 'all' && !present) ? '#f59e0b' : '#4f46e5';
              const opacity = (filterMode === 'all' && !present) ? 0.75 : 1;
              return { type: 'rect', shape: { x: left, y: y - h / 2, width: width, height: h }, style: api.style({ fill, opacity }) };
            },
            universalTransition: true,
            clip: true,
            dimensions: ['start', 'end', 'row', 'present'],
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
  // Update x-axis full extent and selection window (overview never re-ranges)
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    const now = Date.now();
    const PRE_PAD = 30 * 60 * 1000;
    const LIVE_PAD = 5 * 60 * 1000;
    const FINISHED_PAD = 30 * 60 * 1000;
    // Full extent (overview track)
    let fullMin = now - OFFLINE_WINDOW_MS;
    let fullMax = now + LIVE_PAD;
    const ext = getDataExtent();
    if (ext) { fullMin = ext.min - PRE_PAD; fullMax = ext.max + LIVE_PAD; }
    // Selection window (thumbs)
    let selStart = winStart, selEnd = winEnd;
    if (fitMode && ext) {
      selStart = fullMin; selEnd = fullMax;
    } else if (!(selStart != null && selEnd != null && selEnd > selStart)) {
      if (selectedSessionId && selectedSessionId !== 'offline' && Array.isArray(sessions)) {
        const activeId = activeSessionIdRef.current;
        const meta = sessions.find(s => s.id === selectedSessionId) || (activeId ? sessions.find(s => s.id === activeId) : null);
        if (meta) {
          const start = typeof meta.start === 'number' ? meta.start : (Date.parse(meta.id) || now);
          const end = meta.end || null;
          selStart = start - PRE_PAD;
          selEnd = end ? (end + FINISHED_PAD) : (now + LIVE_PAD);
        }
      }
      // Fallbacks
      if (!(selStart != null && selEnd != null && selEnd > selStart)) {
        if (ext) { selStart = fullMin; selEnd = fullMax; }
        else { selStart = now - 60 * 60 * 1000; selEnd = now; }
      }
    }
    // If selection has no data but data exists, auto-fit selection to data extent
    if (ext && selStart != null && selEnd != null && !windowHasData(selStart, selEnd)) {
      selStart = fullMin; selEnd = fullMax;
    }
    // Clamp selection to full extent to keep slider sane
    if (selStart != null && selEnd != null) {
      if (ext) {
        selStart = Math.max(fullMin, Math.min(selStart, fullMax));
        selEnd = Math.max(fullMin, Math.min(selEnd, fullMax));
        if (selEnd <= selStart) selEnd = Math.min(fullMax, selStart + 60 * 1000);
      }
    }
    // Apply pin-right: if pinned, keep end at fullMax as time advances
    if (pinRight && selEnd != null && fullMax != null && selEnd !== fullMax) {
      selEnd = fullMax;
      if (winEnd !== selEnd) {
        setWinEnd(selEnd);
        const name = (login||'').trim();
        if (name) saveJSON(windowKeyNorm(name), { start: selStart, end: selEnd });
      }
    }
    // Only update if values actually changed
    const lastFull = lastFullRef.current;
    const lastSel = lastSelRef.current;
    const needFull = fullMin !== lastFull.min || fullMax !== lastFull.max;
    const needSel = selStart !== lastSel.start || selEnd !== lastSel.end;
    if (!needFull && !needSel) return;
    lastFullRef.current = { min: fullMin, max: fullMax };
    lastSelRef.current = { start: selStart, end: selEnd };
    // Apply: xAxis shows full extent; dataZoom thumbs show selection
    zoomLockRef.current = true;
    inst.setOption({
      axisPointer: { label: { formatter: (obj) => {
        const raw = obj && obj.value;
        const val = Array.isArray(raw) ? raw[0] : raw;
        if (typeof val === 'number' && isFinite(val)) return dtfFull.format(val);
        if (typeof val === 'string') { const t = Date.parse(val); if (!Number.isNaN(t)) return dtfFull.format(t); }
        return String(val ?? '');
      } } },
      xAxis: needFull ? [{ type: 'time', min: fullMin, max: fullMax, axisLabel: { formatter: (val) => dtfTick.format(val) } }] : undefined,
      dataZoom: needSel ? [
        {
          type: 'slider',
          show: true,
          xAxisIndex: 0,
          filterMode: 'none',
          throttle: 100,
          height: 24,
          bottom: 4,
          brushSelect: false,
          startValue: selStart,
          endValue: selEnd,
        }
      ] : undefined,
    }, { notMerge: false });
    inst.resize();
    const flowInst = flowChartInstance.current;
    if (flowInst && needSel) {
      flowInst.setOption({ xAxis: [{ type: 'time', min: selStart, max: selEnd, axisLabel: { formatter: (val) => dtfTick.format(val) } }] }, { notMerge: false });
      flowInst.resize();
    }
    setTimeout(() => { zoomLockRef.current = false; }, 0);
  }, [timeZone, selectedSessionId, sessions, isLive, fitMode, winStart, winEnd, chartReady]);

  // Handle dataZoom (range selector) changes with snapping (60s)
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst || !chartReady) return;
    const SNAP_MS = 60 * 1000;
    const handler = (params) => {
      if (zoomLockRef.current) return;
      try {
        const dz = params && (params.batch ? params.batch[0] : params) || {};
        let s = (typeof dz.startValue === 'number') ? dz.startValue : null;
        let e = (typeof dz.endValue === 'number') ? dz.endValue : null;
        if (s == null || e == null) {
          const opt = inst.getOption();
          const dz0 = opt && opt.dataZoom && opt.dataZoom[0];
          if (dz0) { s = dz0.startValue; e = dz0.endValue; }
        }
        if (typeof s !== 'number' || typeof e !== 'number' || !(e > s)) return;
        let ss = s, ee = e;
        if (Array.isArray(sessions)) {
          const bounds = [];
          for (const meta of sessions) {
            if (meta && typeof meta.start === 'number') bounds.push(meta.start);
            if (meta && typeof meta.end === 'number') bounds.push(meta.end);
          }
          const snap = (val) => {
            let best = val, bestD = SNAP_MS + 1;
            for (const b of bounds) {
              if (typeof b !== 'number') continue;
              const d = Math.abs(val - b);
              if (d < bestD) { bestD = d; best = b; }
            }
            return bestD <= SNAP_MS ? best : val;
          };
          ss = snap(s);
          ee = snap(e);
          if (!(ee > ss)) { ee = s; ss = s; }
        }
        // Determine if end thumb is at right edge (pin it)
        const PRE_PAD = 30 * 60 * 1000;
        const LIVE_PAD = 5 * 60 * 1000;
        const ext = getDataExtent();
        let fullMax = ee;
        if (ext) fullMax = ext.max + LIVE_PAD;
        const atRight = typeof fullMax === 'number' && Math.abs(ee - fullMax) <= SNAP_MS;
        setPinRight(atRight);
        const name = (login||'').trim();
        setFitMode(false);
        setWinStart(ss);
        setWinEnd(ee);
        if (name) saveJSON(windowKeyNorm(name), { start: ss, end: ee });
        zoomLockRef.current = true;
        inst.dispatchAction({ type: 'dataZoom', startValue: ss, endValue: ee, xAxisIndex: 0 });
        setTimeout(() => { zoomLockRef.current = false; }, 0);
      } catch {}
    };
    inst.on('dataZoom', handler);
    return () => { inst.off('dataZoom', handler); };
  }, [sessions, login, chartReady]);

  // Update flow chart series data (linked to window elsewhere)
  useEffect(() => {
    const inst = flowChartInstance.current;
    if (!inst) return;
    const inData = (Array.isArray(flowPoints) ? flowPoints : []).map(p => ({ value: [p.t, p.in || 0], ins: p.ins || [], outs: p.outs || [] }));
    const outData = (Array.isArray(flowPoints) ? flowPoints : []).map(p => ({ value: [p.t, -(p.out || 0)], ins: p.ins || [], outs: p.outs || [] }));
    inst.setOption({
      series: [
        { type: 'bar', name: 'Arrivals', barWidth: 14, itemStyle: { color: '#10b981' }, data: inData },
        { type: 'bar', name: 'Departures', barWidth: 14, itemStyle: { color: '#ef4444' }, data: outData },
      ],
    }, { notMerge: false });
    inst.resize();
  }, [flowPoints, tick]);

  // Update series data when rows or segments change
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    const now = nowMarkTs;
    const dataArr = [];
    // Determine current window from chart option for clipping
    let wStart = null, wEnd = null;
    const opt = inst.getOption();
    const xa = opt && opt.xAxis && opt.xAxis[0] || {};
    if (typeof xa.min === 'number' && typeof xa.max === 'number') { wStart = xa.min; wEnd = xa.max; }
    const segs = segmentsRef.current;
    for (let i = 0; i < visRows.length; i++) {
      const loginKey = visRows[i];
      const rowIndex = (visRows.length - 1 - i); // invert so first is at top
      const arr = segs.get(loginKey) || [];
      const presentFlag = (arr.length > 0 && arr[arr.length - 1].end == null) ? 1 : 0;
      for (let idx = 0; idx < arr.length; idx++) {
        const seg = arr[idx];
        const segEnd = (seg.end == null ? now : seg.end);
        let s0 = seg.start;
        let e0 = segEnd;
        let clipL = 0, clipR = 0;
        if (typeof wStart === 'number' && s0 < wStart) { s0 = wStart; clipL = 1; }
        if (typeof wEnd === 'number' && e0 > wEnd) { e0 = wEnd; clipR = 1; }
        if (s0 >= e0) continue;
        dataArr.push({ id: `${loginKey}__${idx}`, value: [s0, e0, rowIndex, presentFlag, clipL, clipR], login: loginKey });
      }
    }
    // Build session markAreas
    const sessAreas = [];
    if (Array.isArray(sessions) && sessions.length > 0) {
      for (const s of sessions) {
        const st = typeof s.start === 'number' ? s.start : Date.parse(s.id);
        const en = (s.end || null);
        if (typeof st === 'number') {
          sessAreas.push([{ xAxis: st }, { xAxis: en || now }]);
        }
      }
    }
    inst.setOption({
      yAxis: [
        { type: 'value', min: -0.5, max: visRows.length - 0.5, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }, name: 'People' },
        { type: 'value', min: 0, max: 'dataMax', axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLine: { show: false } }
      ],
      series: [
        {
          type: 'line',
          name: 'Present count (overview)',
          step: 'end',
          symbol: 'none',
          smooth: false,
          z: 1,
          yAxisIndex: 1,
          lineStyle: { color: '#64748b', opacity: 0.25, width: 1 },
          areaStyle: { color: '#64748b', opacity: 0.08 },
          data: (() => {
            // Build step series from all intervals
            const events = [];
            for (const arr of segmentsRef.current.values()) {
              for (const seg of arr) {
                if (typeof seg.start === 'number') events.push([seg.start, +1]);
                if (typeof seg.end === 'number') events.push([seg.end, -1]);
              }
            }
            events.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
            let cur = 0; const out = [];
            for (const ev of events) { cur += ev[1]; out.push([ev[0], Math.max(0, cur)]); }
            if (out.length === 0) return out;
            // ensure now point (matches NOW mark line)
            out.push([now, Math.max(0, cur)]);
            return out;
          })(),
        },
        {
          type: 'custom',
          name: 'Presence',
          coordinateSystem: 'cartesian2d',
          renderItem: function (params, api) {
            const start = api.value(0);
            const end = api.value(1);
            const row = api.value(2);
            const present = api.value(3) === 1;
            const clipL = api.value(4) === 1;
            const clipR = api.value(5) === 1;
            const x0 = api.coord([start, row])[0];
            const x1 = api.coord([end, row])[0];
            const y = api.coord([start, row])[1];
            const band = api.size([0, 1])[1];
            const h = Math.max(2, band * 0.6);
            let left = Math.min(x0, x1);
            let width = Math.max(1, Math.abs(x1 - x0));
            // If the bar is effectively zero-width (newly opened presence), render a 1px bar just to the left of NOW
            if (Math.abs(x1 - x0) < 0.5) {
              left = x0 - 1;
              width = 1;
            }
            const fill = (filterMode === 'all' && !present) ? '#f59e0b' : '#4f46e5';
            const opacity = (filterMode === 'all' && !present) ? 0.75 : 1;
            const children = [
              { type: 'rect', shape: { x: left, y: y - h / 2, width: width, height: h }, style: api.style({ fill, opacity }) },
            ];
            const stubW = 6;
            const stubH = Math.max(2, h * 0.6);
            const stubStyle = { fill, opacity: 0.3 };
            if (clipL) children.push({ type: 'rect', shape: { x: left - stubW - 1, y: y - stubH / 2, width: stubW, height: stubH }, style: stubStyle });
            if (clipR) children.push({ type: 'rect', shape: { x: left + Math.max(0, width - stubW - 1), y: y - stubH / 2, width: stubW, height: stubH }, style: stubStyle });
            return { type: 'group', children };
          },
          universalTransition: true,
          clip: true,
          dimensions: ['start', 'end', 'row', 'present', 'clipL', 'clipR'],
          encode: { x: [0, 1], y: 2 },
          markArea: sessAreas.length ? { itemStyle: { color: '#64748b22' }, data: sessAreas } : undefined,
          markLine: {
            symbol: 'none',
            lineStyle: { color: '#94a3b8', width: 1, type: 'solid' },
            label: {
              show: true,
              formatter: (p) => {
                try {
                  const v = (p && (typeof p.value === 'number' ? p.value : (typeof p.xAxis === 'number' ? p.xAxis : null)));
                  return (typeof v === 'number' && isFinite(v)) ? dtfFull.format(v) : '';
                } catch { return ''; }
              },
              color: '#475569',
              backgroundColor: 'transparent',
            },
            silent: true,
            data: [{ xAxis: nowMarkTs }]
          },
          data: dataArr,
        }
      ]
    }, { notMerge: false });
    inst.resize();
  }, [visRows, tick, sessions, nowMarkTs]);

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
      <Heading size="5">Chatters Timeline — {visRows.length} users</Heading>
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
            <Button variant={filterMode==='present' ? 'solid' : 'soft'} onClick={() => setFilterMode('present')}>In chat now</Button>
            <Button variant={filterMode==='all' ? 'solid' : 'soft'} onClick={() => setFilterMode('all')}>All users</Button>
            <Button
              variant={fitMode ? 'solid' : 'soft'}
              color="gray"
              onClick={() => {
                const next = !fitMode;
                setFitMode(next);
                const name = (login||'').trim();
                if (name) saveJSON(fitKeyNorm(name), next);
                if (next) { setPinRight(true); fitToData(); }
              }}
            >Fit mode</Button>
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
      <Box mt="3" style={{ height: 180 }}>
        <div ref={flowChartRef} style={{ width: '100%', height: '100%' }} />
      </Box>
    </Card>
  );
}
