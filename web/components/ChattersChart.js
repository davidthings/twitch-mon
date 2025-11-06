import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Heading, Text, Card, Flex, Button, Separator, Code, TextField } from '@radix-ui/themes';
import { getSelectedTimeZone, setSelectedTimeZone, getRecentTimeZones, getSelectedChannel } from '../lib/settings';
import { useAuth } from '../lib/useAuth';
import { getUsersByLogin, getChatters, getStreamsByLogin } from '../lib/helix';

export default function ChattersChart() {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const distChartRef = useRef(null);
  const distChartInstance = useRef(null);
  const detailsRef = useRef(null);

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
  const lastHoverLoginRef = useRef(null);
  const hoverRafRef = useRef(0);
  const hiCacheRef = useRef(new Map()); // key: `${login}|${min}|${max}` -> array data
  const rowIndexMapRef = useRef(new Map());
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
  const [search, setSearch] = useState('');
  const [pinMode, setPinMode] = useState(false);
  const [pinnedArr, setPinnedArr] = useState([]);
  const pinnedSet = useMemo(() => new Set(Array.isArray(pinnedArr) ? pinnedArr : []), [pinnedArr]);
  const [yStartIdx, setYStartIdx] = useState(0);
  const [yEndIdx, setYEndIdx] = useState(0);
  const [sortMode, setSortMode] = useState('default'); // 'default' | 'time'
  const [selectedLogin, setSelectedLogin] = useState(null);
  const selectedLoginRef = useRef(null);
  const [selectedLogins, setSelectedLogins] = useState([]);
  const selectedLoginsRef = useRef([]);
  const visRowsRef = useRef([]);
  const navListRef = useRef([]);
  const navSnapRef = useRef(null); // active snapshot used during Arrow nav
  const [orderLocked, setOrderLocked] = useState(false);
  const orderLockedRef = useRef(false);
  // Chat messages capture and dots
  const messagesRef = useRef(new Map()); // login -> [{ t, id?, txt }]
  const [messagesTick, setMessagesTick] = useState(0);
  const [showMsgDots, setShowMsgDots] = useState(true);
  const [captureMsgs, setCaptureMsgs] = useState(false);
  const showDebugRef = useRef(false);
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);

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

  const clearChatterAndSessions = useMemo(() => () => {
    const name = (login || '').trim();
    if (!name) return;
    try {
      if (!window.confirm('Delete all chatter and session data for this channel? This cannot be undone.')) return;
      const prefNorm = presenceAllKeyNorm(name);
      const prefLegacy = presenceAllKeyLegacy(name);
      const sessK = sessionsKey(name);
      const selSessK = selectedSessionKey(name);
      const flowK = flowKeyNorm(name);
      const resK = resultKey(name);
      try { localStorage.removeItem(prefNorm); } catch {}
      try { localStorage.removeItem(prefLegacy); } catch {}
      try { localStorage.removeItem(sessK); } catch {}
      try { localStorage.removeItem(selSessK); } catch {}
      try { localStorage.removeItem(flowK); } catch {}
      try { localStorage.removeItem(resK); } catch {}
      const prefixA = `tm_chatters_presence_${(name||'').trim()}_`;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith(prefixA)) {
          try { localStorage.removeItem(k); } catch {}
        }
      }
    } finally {
      segmentsRef.current = new Map();
      messagesRef.current = new Map();
      setRows([]);
      setSessions([]);
      setSelectedSessionId(null);
      setFlowPoints([]);
      setTick(t => t + 1);
      setMessagesTick(t => t + 1);
    }
  }, [login]);

  // Initialize duration distribution chart once
  useEffect(() => {
    let disposed = false;
    async function init() {
      const echarts = await import('echarts');
      if (disposed) return;
      const el = distChartRef.current;
      if (!el) return;
      const inst = echarts.init(el);
      distChartInstance.current = inst;
      const handleResize = () => inst.resize();
      window.addEventListener('resize', handleResize);
      const DEFAULT_W = 60 * 60 * 1000;
      inst.setOption({
        animation: false,
        grid: [{ left: 40, right: 56, top: 8, bottom: 30, containLabel: true }],
        tooltip: {
          trigger: 'item',
          formatter: (p) => {
            try {
              const d = p && p.data;
              const start = d && d.startMs;
              const end = d && d.endMs;
              const cnt = d && d.value ? d.value[1] : 0;
              return `${fmtShortDur(start || 0)} – ${fmtShortDur(end || 0)}: ${cnt}`;
            } catch { return ' '; }
          }
        },
        xAxis: [{ type: 'value', min: 0, max: DEFAULT_W, boundaryGap: false, axisLabel: { formatter: (val) => fmtShortDur(val) } }],
        yAxis: [{ type: 'value', min: 0, max: 'dataMax', name: 'People' }],
        series: [ { type: 'bar', name: 'Duration distribution', barWidth: 10, barGap: '0%', data: [] } ],
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
  // (Flow chart unified into main chart)

  // Keep a live reference to the current rows
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { selectedLoginRef.current = selectedLogin; }, [selectedLogin]);
  useEffect(() => { selectedLoginsRef.current = Array.isArray(selectedLogins) ? selectedLogins : []; }, [selectedLogins]);
  useEffect(() => { visRowsRef.current = visRows; }, [visRows]);
  useEffect(() => { orderLockedRef.current = orderLocked; }, [orderLocked]);
  // Keep nav base order equal to current visible order (visRows is top-to-bottom)
  useEffect(() => {
    navListRef.current = (visRows || []).slice();
    // Do NOT clear navSnapRef here; keep it stable during active navigation
  }, [visRows]);

  // When switching views (e.g., Sort By Time), recompute nav order from actual on-screen positions
  useEffect(() => {
    if (!chartReady) return;
    const inst = chartInstance.current;
    if (!inst) return;
    try {
      const list = visRowsRef.current || [];
      const opt = inst.getOption();
      const xa0 = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : null;
      const xMid = (typeof xa0?.min === 'number' && typeof xa0?.max === 'number') ? ((xa0.min + xa0.max) / 2) : Date.now();
      const items = [];
      for (let i = 0; i < list.length; i++) {
        const lg = list[i];
        const row = rowIndexMapRef.current.get(lg);
        if (typeof row !== 'number') continue;
        const px = inst.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [xMid, row]);
        const py = Array.isArray(px) ? px[1] : Number.POSITIVE_INFINITY;
        items.push({ login: lg, py });
      }
      items.sort((a, b) => a.py - b.py);
      navListRef.current = items.map(it => it.login);
    } catch {
      navListRef.current = (visRowsRef.current || []).slice();
    }
    // Clear active snapshot so first Arrow uses the updated order
    navSnapRef.current = null;
  }, [sortMode, chartReady]);

  useEffect(() => {
    if (!broadcasterId || !user) return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    let disposed = false;
    async function pollOnce() {
      try {
        if (showDebugRef.current) console.debug('[chatters] poll start', { at: new Date().toISOString(), broadcasterId, moderatorId: user.id });
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
          if (showDebugRef.current) console.debug('[chatters] poll result', { at: new Date().toISOString(), presentCount: present.size, arrivals, departures });
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
              const prevU = existing && existing.users && existing.users[k];
              const prevMsgs = messagesRef.current.get(k) || (prevU && Array.isArray(prevU.messages) ? prevU.messages : []);
              base.users[k] = { name: (namesRef.current.get(k) || (prevU && prevU.name) || k), intervals: arr.map(s => ({ start: s.start, end: s.end == null ? null : s.end })), messages: prevMsgs };
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
        if (showDebugRef.current) console.debug('[chatters] poll error', e);
        if (!disposed) setPollInfo({ at: Date.now(), count: 0, error: (e && e.message) ? String(e.message) : 'poll failed' });
      }
    }
    pollOnce();
    pollRef.current = setInterval(pollOnce, 5000);
    return () => { disposed = true; if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [broadcasterId, user, login]);

  // Initialize / adjust vertical window when the visible rows list changes
  useEffect(() => {
    const n = visRows.length;
    if (n === 0) { setYStartIdx(0); setYEndIdx(0); return; }
    const prevStart = yStartIdx;
    const prevEnd = yEndIdx;
    const defaultWindow = Math.min(250, n - 1);
    let ns = prevStart, ne = prevEnd;
    if (!(prevStart >= 0 && prevEnd >= prevStart && prevEnd < n)) {
      ns = 0; ne = defaultWindow;
    } else {
      // Clamp to new bounds
      ns = Math.max(0, Math.min(prevStart, n - 1));
      ne = Math.max(ns, Math.min(prevEnd, n - 1));
    }
    if (ns !== yStartIdx) setYStartIdx(ns);
    if (ne !== yEndIdx) setYEndIdx(ne);
  }, [visRows.length]);

  // Keep a fast lookup of login -> current row index
  useEffect(() => {
    const m = new Map();
    for (let i = 0; i < visRows.length; i++) {
      const loginKey = visRows[i];
      const rowIndex = (visRows.length - 1 - i);
      m.set(loginKey, rowIndex);
    }
    rowIndexMapRef.current = m;
  }, [visRows]);

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
      const msgsAll = messagesRef.current.get(loginKey) || [];
      const hasMsgAny = msgsAll.length > 0;
      let hasMsgWin = false;
      // Filter out users that don't intersect the window if we have one
      if (typeof wStart === 'number' && typeof wEnd === 'number') {
        let intersectsSeg = false;
        for (const seg of arr) {
          const e = seg.end == null ? now : seg.end;
          if (seg.start <= wEnd && e >= wStart) { intersectsSeg = true; break; }
        }
        // Also include users that have any messages within the window
        for (const m of msgsAll) {
          const t = m && m.t;
          if (typeof t !== 'number') continue;
          if (t >= wStart && t <= wEnd) { hasMsgWin = true; break; }
        }
        if (!intersectsSeg && !hasMsgWin) continue;
      }
      // Search filter
      const q = (search || '').trim().toLowerCase();
      if (q) {
        const display = (namesRef.current.get(loginKey) || loginKey || '').toLowerCase();
        if (!display.includes(q)) continue;
      }
      const last = arr[arr.length - 1];
      const present = !!(last && last.end == null);
      const currentStart = present ? last.start : null;
      const currentDur = present && typeof currentStart === 'number' ? (now - currentStart) : 0;
      let lastVisit = -Infinity;
      if (arr.length > 0) {
        const l = arr[arr.length - 1];
        lastVisit = (l && l.end == null) ? l.start : (l ? l.end : -Infinity);
      }
      let windowMs = 0;
      let totalMs = 0;
      if (arr.length > 0) {
        for (const seg of arr) {
          if (typeof seg.start !== 'number') continue;
          const eAll = seg.end == null ? now : seg.end;
          if (eAll > seg.start) totalMs += (eAll - seg.start);
          if (typeof wStart === 'number' && typeof wEnd === 'number') {
            const s = Math.max(wStart, seg.start);
            const e = Math.min(wEnd, seg.end == null ? now : seg.end);
            if (e > s) windowMs += (e - s);
          }
        }
      }
      stats.push({ login: loginKey, present, currentDur, lastVisit, windowMs, totalMs, hasMsgAny, hasMsgWin });
    }
    // Apply filtering and sorting
    let filtered = stats.slice();
    if (filterMode === 'present') {
      filtered = filtered.filter(s => s.present);
    } else if (filterMode === 'messagers') {
      if (typeof wStart === 'number' && typeof wEnd === 'number') {
        filtered = filtered.filter(s => !!s.hasMsgWin);
      } else {
        filtered = filtered.filter(s => !!s.hasMsgAny);
      }
    }
    if (sortMode === 'time') {
      // Total time in room (all history), highest on top
      filtered.sort((a, b) => {
        if (b.totalMs !== a.totalMs) return b.totalMs - a.totalMs;
        if (b.lastVisit !== a.lastVisit) return b.lastVisit - a.lastVisit;
        return a.login.localeCompare(b.login);
      });
      setVisRows(filtered.map(x => x.login));
    } else if (sortMode === 'ins') {
      const presentStats = filtered.filter(s => s.present).sort((a, b) => {
        if (b.lastVisit !== a.lastVisit) return b.lastVisit - a.lastVisit;
        return a.login.localeCompare(b.login);
      });
      const notPresentStats = filtered.filter(s => !s.present).sort((a, b) => {
        if (b.lastVisit !== a.lastVisit) return b.lastVisit - a.lastVisit;
        return a.login.localeCompare(b.login);
      });
      const ordered = [...presentStats, ...notPresentStats];
      const pinnedFirst = [];
      const rest = [];
      for (const it of ordered) { (pinnedSet.has(it.login) ? pinnedFirst : rest).push(it); }
      setVisRows([...pinnedFirst, ...rest].map(x => x.login));
    } else {
      // Order entered/exited: present first by longest current duration; then not-present by recency
      const presentStats = filtered.filter(s => s.present).sort((a, b) => {
        if (b.currentDur !== a.currentDur) return b.currentDur - a.currentDur;
        if (b.lastVisit !== a.lastVisit) return b.lastVisit - a.lastVisit;
        return a.login.localeCompare(b.login);
      });
      const notPresentStats = filtered.filter(s => !s.present).sort((a, b) => {
        if (b.lastVisit !== a.lastVisit) return b.lastVisit - a.lastVisit;
        return a.login.localeCompare(b.login);
      });
      const ordered = [...presentStats, ...notPresentStats];
      const pinnedFirst = [];
      const rest = [];
      for (const it of ordered) { (pinnedSet.has(it.login) ? pinnedFirst : rest).push(it); }
      setVisRows([...pinnedFirst, ...rest].map(x => x.login));
    }
  }, [rows, filterMode, winStart, winEnd, search, pinnedSet, sortMode, messagesTick]);

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
      const savedPins = loadJSON(pinsKeyNorm(name), []);
      setPinnedArr(Array.isArray(savedPins) ? savedPins : []);
    }
  }, [login]);

  // Throttle 'now' mark line updates (every ~10s)
  useEffect(() => {
    const t = setInterval(() => setNowMarkTs(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // Click-to-pin handler (active only in pin mode)
  useEffect(() => {
    if (!pinMode) return;
    const inst = chartInstance.current;
    if (!inst) return;
    const handler = (p) => {
      try {
        const d = p && p.data;
        const loginKey = d && d.login;
        if (!loginKey) return;
        setPinnedArr(prev => {
          const arr = Array.isArray(prev) ? prev.slice() : [];
          const idx = arr.indexOf(loginKey);
          if (idx === -1) arr.push(loginKey); else arr.splice(idx, 1);
          const name = (login||'').trim();
          if (name) saveJSON(pinsKeyNorm(name), arr);
          return arr;
        });
      } catch {}
    };
    inst.on('click', handler);
    return () => { inst.off('click', handler); };
  }, [pinMode, login]);

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
  const pinsKeyNorm = (lg) => `tm_chatters_pins_${(lg||'').trim().toLowerCase()}`;
  const msgsCaptureKey = (lg) => `tm_chatters_capture_msgs_${(lg||'').trim().toLowerCase()}`;
  const msgDotsKey = (lg) => `tm_chatters_show_msg_dots_${(lg||'').trim().toLowerCase()}`;

  const tzResolved = timeZone === 'system' ? undefined : timeZone;
  const dtfTick = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, hour: '2-digit', minute: '2-digit' }), [timeZone]);
  const dtfFull = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), [timeZone]);
  const dtfShort = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }), [timeZone]);

  // Duration label formatter (compact)
  const fmtShortDur = useMemo(() => (ms) => {
    if (!(typeof ms === 'number') || !isFinite(ms) || ms < 0) return '0s';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`;
    if (m > 0) return `${m}m${sec > 0 ? ` ${sec}s` : ''}`;
    return `${sec}s`;
  }, [timeZone]);

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
    inst.setOption({
      xAxis: [
        { type: 'time', min: minX, max: maxX, gridIndex: 0, axisLabel: { formatter: (val) => dtfTick.format(val) } },
        { type: 'time', min: minX, max: maxX, gridIndex: 1, axisLabel: { formatter: (val) => dtfTick.format(val) } },
      ]
    }, { notMerge: false });
    inst.resize();
  }

  const exportPresenceJson = useMemo(() => () => {
    const name = (login || '').trim();
    const users = {};
    for (const [k, arr] of segmentsRef.current.entries()) {
      users[k] = {
        name: namesRef.current.get(k) || k,
        intervals: (Array.isArray(arr) ? arr : []).map(s => ({ start: s.start, end: s.end == null ? null : s.end })),
        messages: Array.isArray(messagesRef.current.get(k)) ? messagesRef.current.get(k) : []
      };
    }
    const payload = { channel: name, exportedAt: Date.now(), sessions: Array.isArray(sessions) ? sessions : [], selectedSessionId: selectedSessionId || null, users };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `tm_presence_${name || 'channel'}_${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [login, sessions, selectedSessionId]);

  const importPresenceJson = useMemo(() => () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      try {
        const file = e && e.target && e.target.files && e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object') return;
        const users = payload.users || {};
        const segs = new Map();
        const labels = new Map();
        const r = [];
        for (const k of Object.keys(users)) {
          const u = users[k] || {};
          labels.set(k, u.name || k);
          const src = Array.isArray(u.intervals) ? u.intervals : [];
          segs.set(k, src.map(it => ({ start: it.start, end: it.end == null ? null : it.end })));
          // load messages
          const msgs = Array.isArray(u.messages) ? u.messages : [];
          messagesRef.current.set(k, msgs);
          r.push(k);
        }
        namesRef.current = labels;
        segmentsRef.current = segs;
        setRows(r);
        const sess = Array.isArray(payload.sessions) ? payload.sessions : [];
        setSessions(sess);
        const sel = payload.selectedSessionId || null;
        if (sel != null) setSelectedSessionId(sel);
        setTick(t => t + 1);
        // Optionally fit to the imported data
        setTimeout(() => { try { fitToData(); } catch {} }, 0);
      } catch {}
    };
    input.click();
  }, []);

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
      // Assume capture and dots are ON by default
      setCaptureMsgs(true); try { saveJSON(msgsCaptureKey(lg), true); } catch {}
      setShowMsgDots(true); try { saveJSON(msgDotsKey(lg), true); } catch {}
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
      // Seed messages from stored presence
      try {
        const cur = loadJSON(presenceAllKeyNorm(lg), null);
        if (cur && cur.users) {
          const m = new Map();
          for (const k of Object.keys(cur.users)) {
            const u = cur.users[k] || {};
            const msgs = Array.isArray(u.messages) ? u.messages : [];
            if (msgs.length) m.set(k, msgs);
          }
          messagesRef.current = m;
        } else {
          messagesRef.current = new Map();
        }
      } catch { messagesRef.current = new Map(); }
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
        grid: [
          { left: 40, right: 56, top: 16, height: '62%', containLabel: false },
          { left: 40, right: 56, top: '72%', height: '18%', containLabel: false },
        ],
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
        tooltip: { trigger: 'item', confine: true, extraCssText: 'max-width: 520px; white-space: normal; line-height: 1.2; word-break: break-word; overflow-wrap: anywhere;', formatter: (params) => {
          try {
            const p = Array.isArray(params) ? params[0] : params;
            if (!p || p.seriesId !== 'presence') return ' ';
            const d = p.data;
            const loginKey = d && d.login;
            if (!loginKey) return ' ';
            const uname = (namesRef.current.get(loginKey)) || loginKey || '';
            const arr = segmentsRef.current.get(loginKey) || [];
            const now = Date.now();
            // Determine current main chart window (top xAxis)
            let wStartH = null, wEndH = null;
            try {
              const optH = inst.getOption();
              const xaH = (optH && Array.isArray(optH.xAxis) && optH.xAxis[0]) || {};
              if (typeof xaH.min === 'number' && typeof xaH.max === 'number') { wStartH = xaH.min; wEndH = xaH.max; }
            } catch {}
            // Compute total time in window
            let windowMs = 0;
            if (typeof wStartH === 'number' && typeof wEndH === 'number') {
              for (const seg of arr) {
                if (typeof seg?.start !== 'number') continue;
                const s = Math.max(wStartH, seg.start);
                const e = Math.min(wEndH, seg.end == null ? now : seg.end);
                if (e > s) windowMs += (e - s);
              }
            }
            // Count messages in window
            const msgsAll = messagesRef.current.get(loginKey) || [];
            let msgCount = 0;
            if (typeof wStartH === 'number' && typeof wEndH === 'number') {
              for (const m of msgsAll) { const t = m && m.t; if (typeof t === 'number' && t >= wStartH && t <= wEndH) msgCount++; }
            } else {
              msgCount = msgsAll.length;
            }
            return `${uname} (${loginKey || ''})<br/>Time in window: ${fmtShortDur(windowMs)}<br/>Messages: ${msgCount}`;
          } catch {
            return ' ';
          }
        } },
        xAxis: [
          { type: 'time', boundaryGap: false, min: minX, max: maxX, gridIndex: 0, axisLabel: { formatter: (val) => dtfTick.format(val) } },
          { type: 'time', boundaryGap: false, min: minX, max: maxX, gridIndex: 1, axisLabel: { formatter: (val) => dtfTick.format(val) } },
        ],
        yAxis: [
          { type: 'value', min: -0.5, max: 0.5, gridIndex: 0, axisLabel: { show: true }, axisTick: { show: false }, splitLine: { show: false }, name: 'People' },
          { type: 'value', min: 0, max: 'dataMax', gridIndex: 0, axisLabel: { show: true }, axisTick: { show: false }, splitLine: { show: false }, name: 'Total in room', position: 'right' },
          { type: 'value', min: -10, max: 10, gridIndex: 1, axisLabel: { show: true }, name: 'Flow' },
        ],
        dataZoom: [
          {
            type: 'slider',
            show: true,
            xAxisIndex: [0, 1],
            filterMode: 'none',
            throttle: 100,
            height: 24,
            bottom: 4,
            brushSelect: false,
            showDetail: true,
            labelFormatter: (val) => {
              try { return (typeof val === 'number' && isFinite(val)) ? dtfFull.format(val) : ''; } catch { return ''; }
            },
            startValue: minX,
            endValue: maxX,
          }
        ],
        series: [
          {
            type: 'custom',
            id: 'presence',
            name: 'Presence',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 0,
            yAxisIndex: 0,
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
              const fill = present ? '#4f46e5' : '#f59e0b';
              const opacity = present ? 1 : 0.75;
              return { type: 'rect', shape: { x: left, y: y - h / 2, width: width, height: h }, style: { fill, opacity } };
            },
            universalTransition: true,
            clip: true,
            dimensions: ['start', 'end', 'row', 'present'],
            encode: { x: [0, 1], y: 2 },
            data: [],
          }
          ,
          // Chat message dots overlay (scatter)
          {
            type: 'scatter',
            id: 'chat-dots',
            name: 'Chat dots',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 0,
            yAxisIndex: 0,
            symbol: 'circle',
            symbolSize: 4,
            itemStyle: { color: '#ffffff', borderColor: '#111827', borderWidth: 1 },
            z: 30,
            clip: true,
            tooltip: {
              trigger: 'item',
              confine: true,
              extraCssText: 'max-width: 520px; white-space: normal; line-height: 1.2; word-break: break-word; overflow-wrap: anywhere;',
              formatter: (p) => {
                try {
                  const d = p && p.data;
                  const t = d && Array.isArray(d.value) ? d.value[0] : null;
                  const txt = (d && d.text) || '';
                  const uname = (d && d.login && (namesRef.current.get(d.login) || d.login)) || '';
                  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (ch) => ch === '&' ? '&amp;' : (ch === '<' ? '&lt;' : '&gt;'));
                  return `${uname ? esc(uname) + '<br/>' : ''}${t != null ? dtfFull.format(t) : ''}${txt ? '<br/>' + esc(txt) : ''}`;
                } catch { return ' '; }
              }
            },
            data: []
          },
          // Presence hover highlight (empty initially; filled on hover)
          {
            type: 'custom',
            id: 'presence-hi',
            name: 'Presence highlight',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 0,
            yAxisIndex: 0,
            z: 20,
            clip: true,
            silent: true,
            tooltip: { show: false },
            renderItem: function (params, api) {
              const start = api.value(0);
              const end = api.value(1);
              const row = api.value(2);
              const x0 = api.coord([start, row])[0];
              const x1 = api.coord([end, row])[0];
              const y = api.coord([start, row])[1];
              const band = api.size([0, 1])[1];
              const h = Math.max(3, band * 0.8);
              let left = Math.min(x0, x1);
              let width = Math.max(1, Math.abs(x1 - x0));
              if (Math.abs(x1 - x0) < 0.5) { left = x0 - 1; width = 1; }
              return { type: 'rect', shape: { x: left, y: y - h / 2, width, height: h }, style: { fill: '#facc15', opacity: 0.85, stroke: '#111827', lineWidth: 1 } };
            },
            data: []
          },
          // Presence persistent selection highlight (empty initially; filled on select)
          {
            type: 'custom',
            id: 'presence-sel',
            name: 'Presence selected',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 0,
            yAxisIndex: 0,
            z: 21,
            clip: true,
            silent: true,
            tooltip: { show: false },
            renderItem: function (params, api) {
              const start = api.value(0);
              const end = api.value(1);
              const row = api.value(2);
              const x0 = api.coord([start, row])[0];
              const x1 = api.coord([end, row])[0];
              const y = api.coord([start, row])[1];
              const band = api.size([0, 1])[1];
              const h = Math.max(3, band * 0.8);
              let left = Math.min(x0, x1);
              let width = Math.max(1, Math.abs(x1 - x0));
              if (Math.abs(x1 - x0) < 0.5) { left = x0 - 1; width = 1; }
              return { type: 'rect', shape: { x: left, y: y - h / 2, width, height: h }, style: { fill: '#0ea5e9', opacity: 0.95, stroke: '#0c4a6e', lineWidth: 1 } };
            },
            data: []
          },
          {
            type: 'custom',
            id: 'flow-arrivals',
            name: 'Arrivals',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 1,
            yAxisIndex: 2,
            clip: true,
            renderItem: function (params, api) {
              const t = api.value(0);
              const v = api.value(1);
              const halfW = api.value(2) || 0;
              const y0 = api.coord([t, 0])[1];
              const y1 = api.coord([t, v])[1];
              const xL = api.coord([t - halfW, 0])[0];
              const xR = api.coord([t + halfW, 0])[0];
              const width = Math.max(2, Math.abs(xR - xL));
              const left = Math.min(xL, xR);
              const top = Math.min(y0, y1);
              const height = Math.abs(y1 - y0);
              return { type: 'rect', shape: { x: left, y: top, width, height }, style: { fill: '#10b981' } };
            },
            data: []
          },
          {
            type: 'custom',
            id: 'flow-departures',
            name: 'Departures',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 1,
            yAxisIndex: 2,
            clip: true,
            renderItem: function (params, api) {
              const t = api.value(0);
              const v = api.value(1);
              const halfW = api.value(2) || 0;
              const y0 = api.coord([t, 0])[1];
              const y1 = api.coord([t, v])[1];
              const xL = api.coord([t - halfW, 0])[0];
              const xR = api.coord([t + halfW, 0])[0];
              const width = Math.max(2, Math.abs(xR - xL));
              const left = Math.min(xL, xR);
              const top = Math.min(y0, y1);
              const height = Math.abs(y1 - y0);
              return { type: 'rect', shape: { x: left, y: top, width, height }, style: { fill: '#ef4444' } };
            },
            data: []
          }
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
      xAxis: needFull ? [
        { type: 'time', boundaryGap: false, min: fullMin, max: fullMax, gridIndex: 0, axisLabel: { formatter: (val) => dtfTick.format(val) } },
        { type: 'time', boundaryGap: false, min: fullMin, max: fullMax, gridIndex: 1, axisLabel: { formatter: (val) => dtfTick.format(val) } },
      ] : undefined,
      dataZoom: [
        {
          type: 'slider',
          show: true,
          xAxisIndex: [0, 1],
          filterMode: 'none',
          throttle: 100,
          height: 24,
          bottom: 4,
          brushSelect: false,
          startValue: selStart,
          endValue: selEnd,
        }
      ],
    }, { notMerge: false });
    inst.resize();
    setTimeout(() => { zoomLockRef.current = false; }, 0);
  }, [timeZone, selectedSessionId, sessions, isLive, fitMode, winStart, winEnd, chartReady]);

  // Handle dataZoom (range selector) changes with snapping (60s) and y-zoom windowing
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst || !chartReady) return;
    const SNAP_MS = 60 * 1000;
    const handler = (params) => {
      if (zoomLockRef.current) return;
      try {
        const dz = params && (params.batch ? params.batch[0] : params) || {};
        // Currently only handle x-axis range selector
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
        inst.dispatchAction({ type: 'dataZoom', startValue: ss, endValue: ee, xAxisIndex: [0, 1] });
        setTimeout(() => { zoomLockRef.current = false; }, 0);
      } catch {}
    };
    inst.on('dataZoom', handler);
    return () => { inst.off('dataZoom', handler); };
  }, [sessions, login, chartReady]);

  // Update flow series data inside the main chart (second grid)
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    const now = nowMarkTs;
    const ptsAll = Array.isArray(flowPoints) ? flowPoints : [];
    // Determine current visible window from selected window first, then dataZoom, then axes
    const opt = inst.getOption();
    let wStart = (typeof winStart === 'number') ? winStart : null;
    let wEnd = (typeof winEnd === 'number') ? winEnd : null;
    if (wStart == null || wEnd == null) {
      const dz = (opt && Array.isArray(opt.dataZoom) && opt.dataZoom[0]) || {};
      if (typeof dz.startValue === 'number' && typeof dz.endValue === 'number') { wStart = dz.startValue; wEnd = dz.endValue; }
    }
    if (wStart == null || wEnd == null) {
      const xa1 = (opt && Array.isArray(opt.xAxis) && opt.xAxis[1]) || {};
      const xa0 = (opt && Array.isArray(opt.xAxis) && opt.xAxis[0]) || {};
      wStart = (typeof xa1.min === 'number') ? xa1.min : ((typeof xa0.min === 'number') ? xa0.min : -Infinity);
      wEnd = (typeof xa1.max === 'number') ? xa1.max : ((typeof xa0.max === 'number') ? xa0.max : Infinity);
    }
    const MARGIN = 60000; // 60s margin to include edge bars
    const pts = ptsAll.filter(p => typeof p.t === 'number' && p.t >= (wStart - MARGIN) && p.t <= (wEnd + MARGIN));
    const DEFAULT_PERIOD = 5000;
    const inData = pts.map((p, i) => {
      const prev = i > 0 ? pts[i - 1].t : null;
      const next = i + 1 < pts.length ? pts[i + 1].t : null;
      const dPrev = (typeof prev === 'number') ? (p.t - prev) : Infinity;
      const dNext = (typeof next === 'number') ? (next - p.t) : Infinity;
      const period = Math.min(dPrev, dNext, DEFAULT_PERIOD);
      const halfW = Math.max(250, Math.floor(0.45 * (isFinite(period) ? period : DEFAULT_PERIOD)));
      const v = (Array.isArray(p.ins) ? p.ins.length : Math.max(0, +p.in || 0));
      return { value: [p.t, v, halfW], ins: p.ins || [] };
    });
    const outData = pts.map((p, i) => {
      const prev = i > 0 ? pts[i - 1].t : null;
      const next = i + 1 < pts.length ? pts[i + 1].t : null;
      const dPrev = (typeof prev === 'number') ? (p.t - prev) : Infinity;
      const dNext = (typeof next === 'number') ? (next - p.t) : Infinity;
      const period = Math.min(dPrev, dNext, DEFAULT_PERIOD);
      const halfW = Math.max(250, Math.floor(0.45 * (isFinite(period) ? period : DEFAULT_PERIOD)));
      const v = (Array.isArray(p.outs) ? p.outs.length : Math.max(0, +p.out || 0));
      return { value: [p.t, -v, halfW], outs: p.outs || [] };
    });
    const inSig = `${inData.length}:${inData[0]?.value?.[0] ?? ''}:${inData[inData.length-1]?.value?.[0] ?? ''}:${inData.reduce((a,d)=>a+Math.abs(d.value?.[1]||0),0)}`;
    const outSig = `${outData.length}:${outData[0]?.value?.[0] ?? ''}:${outData[outData.length-1]?.value?.[0] ?? ''}:${outData.reduce((a,d)=>a+Math.abs(d.value?.[1]||0),0)}`;
    // Compute y-range strictly from points inside [wStart, wEnd]
    let maxAbs = 1;
    for (const d of inData) { const t = d.value?.[0]; if (t >= wStart && t <= wEnd) { const v = Math.abs(d.value?.[1] || 0); if (v > maxAbs) maxAbs = v; } }
    for (const d of outData) { const t = d.value?.[0]; if (t >= wStart && t <= wEnd) { const v = Math.abs(d.value?.[1] || 0); if (v > maxAbs) maxAbs = v; } }
    const yMin = -maxAbs, yMax = maxAbs;
    const prev = window.__tm_flow_cache || { inSig: '', outSig: '', yRange: [0, 0] };
    if (!window.__tm_flow_cache) window.__tm_flow_cache = prev;
    const ySame = prev.yRange[0] === yMin && prev.yRange[1] === yMax;
    const dataSame = prev.inSig === inSig && prev.outSig === outSig;
    if (!dataSame || !ySame) {
      // Update only the flow y-axis range (index 2) and series data, without redefining axes/grids
      inst.setOption({
        yAxis: [{}, {}, { min: yMin, max: yMax }],
        series: [
          { id: 'flow-arrivals', data: inData },
          { id: 'flow-departures', data: outData },
        ],
      }, { notMerge: false });
      window.__tm_flow_cache = { inSig, outSig, yRange: [yMin, yMax] };
    } else {
      // Even if range didn't change, refresh series data
      inst.setOption({
        series: [
          { id: 'flow-arrivals', data: inData },
          { id: 'flow-departures', data: outData },
        ],
      }, { notMerge: false });
    }
    inst.resize();
  }, [flowPoints, winStart, winEnd, chartReady, nowMarkTs]);

  // Recompute and render duration distribution for current window
  useEffect(() => {
    const inst = distChartInstance.current;
    const main = chartInstance.current;
    if (!inst || !main) return;
    // Determine current window (prefer selected window over full extent)
    let wStart = (typeof winStart === 'number') ? winStart : null;
    let wEnd = (typeof winEnd === 'number') ? winEnd : null;
    const opt = main.getOption();
    if (!(typeof wStart === 'number' && typeof wEnd === 'number' && wEnd > wStart)) {
      const dz0 = opt && opt.dataZoom && opt.dataZoom[0];
      if (dz0 && typeof dz0.startValue === 'number' && typeof dz0.endValue === 'number') {
        wStart = dz0.startValue; wEnd = dz0.endValue;
      } else {
        const xa = opt && opt.xAxis && opt.xAxis[0] || {};
        if (typeof xa.min === 'number' && typeof xa.max === 'number') { wStart = xa.min; wEnd = xa.max; }
      }
    }
    if (!(typeof wStart === 'number' && typeof wEnd === 'number' && wEnd > wStart)) return;
    const now = nowMarkTs;
    const W = Math.max(1, wEnd - wStart);
    const targetBins = 30;
    const BIN_COUNT = targetBins;
    const binW = Math.max(1, W / targetBins);
    const bins = new Array(BIN_COUNT).fill(0);
    let totalMs = 0;
    let usersCounted = 0;
    const durations = [];
    // Iterate all users, regardless of search filter
    for (const arr of segmentsRef.current.values()) {
      let sum = 0;
      for (const seg of arr) {
        if (typeof seg.start !== 'number') continue;
        const s = Math.max(wStart, seg.start);
        const e = Math.min(wEnd, seg.end == null ? now : seg.end);
        if (e > s) sum += (e - s);
      }
      if (sum > 0) {
        let idx = Math.floor(sum / binW);
        if (idx >= BIN_COUNT) idx = BIN_COUNT - 1;
        bins[idx] += 1;
        totalMs += sum;
        usersCounted += 1;
        durations.push(sum);
      }
    }
    let maxCnt = 0;
    if (showDebug) {
      try { console.debug('[duration-hist] window', { wStart, wEnd, W }); } catch {}
    }
    const data = bins.map((cnt, i) => {
      const startMs = i * binW;
      const endMs = Math.min(W, (i + 1) * binW);
      const center = startMs + (endMs - startMs) / 2;
      if (cnt > maxCnt) { maxCnt = cnt; }
      return { value: [center, cnt], startMs, endMs };
    });
    // Median across users in the window (true middle value, not middle bin)
    let medianMs = null;
    if (durations.length > 0) {
      const arr = durations.slice().sort((a,b) => a - b);
      const n = arr.length;
      if (n % 2 === 1) medianMs = arr[(n - 1) >> 1];
      else medianMs = (arr[n/2 - 1] + arr[n/2]) / 2;
      if (medianMs < 0) medianMs = 0;
      if (medianMs > W) medianMs = W;
    }
    // Mean across users in the window
    let meanMs = usersCounted > 0 ? (totalMs / usersCounted) : null;
    if (meanMs != null) {
      if (meanMs < 0) meanMs = 0;
      if (meanMs > W) meanMs = W;
    }
    const axisMaxBase = Math.max(maxCnt, 1);
    const axisMax = axisMaxBase + 1; // headroom so the label isn't clipped
    if (showDebug) {
      try {
        const px0 = medianMs != null ? inst.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [medianMs, 0]) : null;
        const px1 = medianMs != null ? inst.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [medianMs, axisMax]) : null;
        const box = distChartRef.current ? { w: distChartRef.current.clientWidth, h: distChartRef.current.clientHeight } : null;
        console.debug('[duration-hist] bin', { binW, BIN_COUNT, maxCnt, axisMax, medianMs, meanMs, px0, px1, box });
      } catch {}
    }
    inst.setOption({
      xAxis: [{ type: 'value', min: 0, max: W, boundaryGap: false, axisLabel: { formatter: (val) => fmtShortDur(val) } }],
      yAxis: [{ type: 'value', min: 0, max: axisMax, name: 'People' }],
      series: [
        {
          type: 'bar',
          name: 'Duration distribution',
          barWidth: Math.max(2, Math.floor(800 / BIN_COUNT)),
          barGap: '0%',
          data
        },
        ...(medianMs != null && isFinite(medianMs) ? [{
          type: 'line',
          name: 'Median',
          xAxisIndex: 0,
          yAxisIndex: 0,
          z: 100,
          zlevel: 100,
          symbol: 'none',
          smooth: false,
          silent: true,
          clip: false,
          lineStyle: { color: '#000', width: 3 },
          data: [
            { value: [medianMs, 0], label: { show: false } },
            { value: [medianMs, axisMax], label: { show: true, position: 'insideTop', color: '#000', backgroundColor: 'rgba(255,255,255,0.85)', padding: [2,4], formatter: () => `median ${fmtShortDur(medianMs)}` } }
          ]
        }] : []),
        ...(meanMs != null && isFinite(meanMs) ? [{
          type: 'line',
          name: 'Mean',
          xAxisIndex: 0,
          yAxisIndex: 0,
          z: 101,
          zlevel: 101,
          symbol: 'none',
          smooth: false,
          silent: true,
          clip: false,
          lineStyle: { color: '#000', width: 2, type: 'dashed' },
          data: [
            { value: [meanMs, 0], label: { show: false } },
            { value: [meanMs, axisMax], label: { show: true, position: 'insideTop', color: '#000', backgroundColor: 'rgba(255,255,255,0.85)', padding: [2,4], formatter: () => `mean ${fmtShortDur(meanMs)}` } }
          ]
        }] : [])
      ]
    }, { notMerge: false });
    inst.resize();
  }, [tick, nowMarkTs, winStart, winEnd, fitMode, chartReady, sessions]);

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
    const opt0 = inst.getOption();
    const hiSeries = (opt0 && Array.isArray(opt0.series)) ? opt0.series.find(s => s && s.id === 'presence-hi') : null;
    const hasHi = !!hiSeries;
    const hiExistingData = (hiSeries && Array.isArray(hiSeries.data)) ? hiSeries.data : [];
    const seriesUpdate = [
      {
        id: 'present-overview',
        type: 'line',
        name: 'Present count (overview)',
        step: 'end',
        symbol: 'none',
        smooth: false,
        z: 12,
        yAxisIndex: 1,
        lineStyle: { color: '#6b7280', opacity: 1, width: 1.5 },
        data: (() => {
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
          out.push([now, Math.max(0, cur)]);
          return out;
        })(),
      },
      {
        id: 'presence',
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
          if (Math.abs(x1 - x0) < 0.5) { left = x0 - 1; width = 1; }
          const fill = present ? '#4f46e5' : '#f59e0b';
          const opacity = present ? 1 : 0.75;
          const children = [ { type: 'rect', shape: { x: left, y: y - h / 2, width, height: h }, style: { fill, opacity } } ];
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
        markArea: sessAreas.length ? { silent: true, tooltip: { show: false }, itemStyle: { color: '#64748b22' }, data: sessAreas } : undefined,
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
      },
      // Ensure chat dots series exists (data updated elsewhere)
      { id: 'chat-dots', type: 'scatter', z: 30, clip: true },
    ];
    if (!hasHi) {
      seriesUpdate.push({ id: 'presence-hi', type: 'custom', name: 'Presence highlight', coordinateSystem: 'cartesian2d', z: 20, clip: true, silent: true, tooltip: { show: false }, renderItem: function (params, api) {
        const start = api.value(0); const end = api.value(1); const row = api.value(2);
        const x0 = api.coord([start, row])[0]; const x1 = api.coord([end, row])[0]; const y = api.coord([start, row])[1];
        const band = api.size([0, 1])[1]; const h = Math.max(3, band * 0.8);
        let left = Math.min(x0, x1); let width = Math.max(1, Math.abs(x1 - x0)); if (Math.abs(x1 - x0) < 0.5) { left = x0 - 1; width = 1; }
        return { type: 'rect', shape: { x: left, y: y - h / 2, width, height: h }, style: { fill: '#facc15', opacity: 0.85, stroke: '#111827', lineWidth: 1 } };
      }, data: hiExistingData });
    } else {
      seriesUpdate.push({ id: 'presence-hi', silent: true, tooltip: { show: false } });
    }
    // Ensure persistent selection highlight series exists
    const selSeries = (opt0 && Array.isArray(opt0.series)) ? opt0.series.find(s => s && s.id === 'presence-sel') : null;
    const selExistingData = (selSeries && Array.isArray(selSeries.data)) ? selSeries.data : [];
    if (!selSeries) {
      seriesUpdate.push({ id: 'presence-sel', type: 'custom', name: 'Presence selected', coordinateSystem: 'cartesian2d', z: 21, clip: true, silent: true, tooltip: { show: false }, renderItem: function (params, api) {
        const start = api.value(0); const end = api.value(1); const row = api.value(2);
        const x0 = api.coord([start, row])[0]; const x1 = api.coord([end, row])[0]; const y = api.coord([start, row])[1];
        const band = api.size([0, 1])[1]; const h = Math.max(3, band * 0.8);
        let left = Math.min(x0, x1); let width = Math.max(1, Math.abs(x1 - x0)); if (Math.abs(x1 - x0) < 0.5) { left = x0 - 1; width = 1; }
        return { type: 'rect', shape: { x: left, y: y - h / 2, width, height: h }, style: { fill: '#0ea5e9', opacity: 0.95, stroke: '#0c4a6e', lineWidth: 1 } };
      }, data: selExistingData });
    } else {
      seriesUpdate.push({ id: 'presence-sel', silent: true, tooltip: { show: false } });
    }
    inst.setOption({
      yAxis: [
        { type: 'value', min: -0.5, max: visRows.length - 0.5, gridIndex: 0, axisLabel: { show: true }, axisTick: { show: false }, splitLine: { show: false }, name: 'People' },
        { type: 'value', min: 0, max: 'dataMax', minInterval: 1, gridIndex: 0, axisLabel: { show: true }, axisTick: { show: false }, splitLine: { show: false }, position: 'right', name: 'Total in room' },
        { type: 'value', min: (window.__tm_flow_cache?.yRange?.[0] ?? -10), max: (window.__tm_flow_cache?.yRange?.[1] ?? 10), minInterval: 1, gridIndex: 1, axisLabel: { show: true }, name: 'Flow' }
      ],
      series: seriesUpdate
    }, { notMerge: false });
    inst.resize();
  }, [visRows, tick, sessions, nowMarkTs]);

  // Compute and render chat message dots for current window
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst || !chartReady) return;
    try {
      // Determine current window from xAxis (prefer selected window)
      const opt = inst.getOption();
      let wStart = (typeof winStart === 'number') ? winStart : null;
      let wEnd = (typeof winEnd === 'number') ? winEnd : null;
      if (!(typeof wStart === 'number' && typeof wEnd === 'number')) {
        const xa0 = (opt && Array.isArray(opt.xAxis) && opt.xAxis[0]) || {};
        if (typeof xa0.min === 'number' && typeof xa0.max === 'number') { wStart = xa0.min; wEnd = xa0.max; }
      }
      if (!(typeof wStart === 'number' && typeof wEnd === 'number')) return;
      const pts = [];
      for (let i = 0; i < visRows.length; i++) {
        const loginKey = visRows[i];
        const rowIndex = (visRows.length - 1 - i);
        const arr = messagesRef.current.get(loginKey) || [];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        // Only messages within window; optionally decimate if needed
        for (const m of arr) {
          const t = m && m.t;
          if (typeof t !== 'number') continue;
          if (t < wStart || t > wEnd) continue;
          pts.push({ value: [t, rowIndex], login: loginKey, text: m.txt || '' });
        }
      }
      inst.setOption({ series: [{ id: 'chat-dots', data: showMsgDots ? pts : [] }] }, { notMerge: false });
      inst.resize();
    } catch {}
  }, [showMsgDots, winStart, winEnd, visRows, chartReady, messagesTick]);

  // Chat client: capture messages (anonymous)
  useEffect(() => {
    let dispose = null;
    const name = (login || '').trim();
    if (!name || !captureMsgs) return;
    let stopped = false;
    (async () => {
      try {
        const mod = await import('../lib/chatClient');
        if (stopped) return;
        if (showDebugRef.current) console.debug('[chat] enabling capture', { channel: name });
        const client = await mod.createAnonChatClient(name, (payload) => {
          try {
            const lg = (payload && payload.login) || '';
            const txt = (payload && payload.txt) || '';
            const id = payload && payload.id;
            const t = (payload && typeof payload.t === 'number') ? payload.t : Date.now();
            if (!lg) return;
            if (showDebugRef.current) console.debug('[chat] message', { user: lg, t, id, txt: (txt || '').slice(0, 200) });
            // Seed display name if missing
            if (!namesRef.current.has(lg)) namesRef.current.set(lg, lg);
            // Ensure the user is present in rows immediately so dots can render
            setRows(prev => (Array.isArray(prev) && prev.includes(lg)) ? prev : ([...(Array.isArray(prev) ? prev : []), lg]));
            const arr = messagesRef.current.get(lg) || [];
            // Simple dedup by last id
            if (id && arr.length > 0 && arr[arr.length - 1].id === id) return;
            arr.push({ t, id, txt });
            // Cap per-user to 2000
            const MAX_PER_USER = 2000;
            if (arr.length > MAX_PER_USER) arr.splice(0, arr.length - MAX_PER_USER);
            messagesRef.current.set(lg, arr);
            // Persist into presence JSON (preserve intervals)
            const chan = (login || '').trim();
            if (chan) {
              const existing = loadJSON(presenceAllKeyNorm(chan), loadJSON(presenceAllKeyLegacy(chan), { users: {} }));
              const base = (existing && existing.users) ? { users: { ...existing.users } } : { users: {} };
              const prevU = base.users[lg] || {};
              const nameLabel = namesRef.current.get(lg) || prevU.name || lg;
              const intervals = Array.isArray(prevU.intervals) ? prevU.intervals : (segmentsRef.current.get(lg) || []).map(s => ({ start: s.start, end: s.end == null ? null : s.end }));
              const msgs = Array.isArray(base.users[lg]?.messages) ? base.users[lg].messages.slice() : [];
              msgs.push({ t, id, txt });
              const MAX = 2000; if (msgs.length > MAX) msgs.splice(0, msgs.length - MAX);
              base.users[lg] = { name: nameLabel, intervals, messages: msgs };
              saveJSON(presenceAllKeyNorm(chan), base);
            }
            setMessagesTick(x => x + 1);
          } catch {}
        });
        if (showDebugRef.current) console.debug('[chat] connecting', { channel: name });
        await client.connect();
        dispose = () => { try { if (showDebugRef.current) console.debug('[chat] disconnecting', { channel: name }); client.disconnect(); } catch {} };
      } catch {}
    })();
    return () => { stopped = true; if (dispose) dispose(); };
  }, [login, captureMsgs]);

  // Persistent selection highlight (multi-select): draw selected users' segments in a dedicated series
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst || !chartReady) return;
    const selArr = (Array.isArray(selectedLogins) ? selectedLogins : []).filter(Boolean);
    if (selArr.length === 0) { try { inst.setOption({ series: [{ id: 'presence-sel', data: [] }] }, { notMerge: false }); } catch {}; return; }
    try {
      // Determine current window from xAxis
      let wStartH = null, wEndH = null;
      const optH = inst.getOption();
      const xaH = (optH && Array.isArray(optH.xAxis) && optH.xAxis[0]) || {};
      if (typeof xaH.min === 'number' && typeof xaH.max === 'number') { wStartH = xaH.min; wEndH = xaH.max; }
      let all = [];
      const nowH = nowMarkTs;
      for (const loginKey of selArr) {
        const key = `${loginKey}|${wStartH}|${wEndH}`;
        let hi = hiCacheRef.current.get(key);
        if (!hi) {
          const arr = segmentsRef.current.get(loginKey) || [];
          const row = rowIndexMapRef.current.get(loginKey);
          if (!(typeof row === 'number')) { hi = []; }
          else {
            hi = [];
            for (let idx2 = 0; idx2 < arr.length; idx2++) {
              const seg = arr[idx2];
              if (typeof seg.start !== 'number') continue;
              const segEnd = (seg.end == null ? nowH : seg.end);
              let s0 = seg.start;
              let e0 = segEnd;
              if (typeof wStartH === 'number' && s0 < wStartH) s0 = wStartH;
              if (typeof wEndH === 'number' && e0 > wEndH) e0 = wEndH;
              if (s0 >= e0) continue;
              hi.push({ value: [s0, e0, row] });
            }
          }
          hiCacheRef.current.set(key, hi);
        }
        if (Array.isArray(hi) && hi.length) all.push(...hi);
      }
      inst.setOption({ series: [{ id: 'presence-sel', data: all }] }, { notMerge: false });
    } catch {}
  }, [selectedLogins, winStart, winEnd, nowMarkTs, chartReady]);

  // Keep tooltip in sync with selected user (show most recent visible segment)
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst || !chartReady) return;
    try {
      const sel = selectedLoginRef.current;
      const opt = inst.getOption();
      const seriesArr = (opt && Array.isArray(opt.series)) ? opt.series : [];
      const presenceSeriesIndex = seriesArr.findIndex(s => s && s.id === 'presence');
      const presenceSeries = presenceSeriesIndex >= 0 ? seriesArr[presenceSeriesIndex] : null;
      if (!sel || !presenceSeries || !Array.isArray(presenceSeries.data)) {
        inst.dispatchAction({ type: 'hideTip' });
        return;
      }
      // Current time window from top xAxis
      let wStart = null, wEnd = null;
      const xa0 = (opt && Array.isArray(opt.xAxis) && opt.xAxis[0]) || {};
      if (typeof xa0.min === 'number' && typeof xa0.max === 'number') { wStart = xa0.min; wEnd = xa0.max; }
      let bestIdx = -1; let bestEnd = -Infinity;
      for (let i = 0; i < presenceSeries.data.length; i++) {
        const d = presenceSeries.data[i];
        if (!d || d.login !== sel) continue;
        const v = Array.isArray(d.value) ? d.value : [];
        const s = v[0], e = v[1];
        if (typeof s !== 'number' || typeof e !== 'number') continue;
        if (wStart != null && wEnd != null) { if (e < wStart || s > wEnd) continue; }
        if (e > bestEnd) { bestEnd = e; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        const item = presenceSeries.data[bestIdx];
        const v = Array.isArray(item.value) ? item.value : [];
        const s = v[0], e = v[1], row = v[2];
        const mid = (typeof s === 'number' && typeof e === 'number') ? (s + e) / 2 : (typeof s === 'number' ? s : (typeof e === 'number' ? e : wStart));
        let pos = null;
        try { pos = inst.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [mid, row]); } catch {}
        if (pos && Array.isArray(pos)) {
          inst.dispatchAction({ type: 'showTip', seriesIndex: presenceSeriesIndex, dataIndex: bestIdx, position: pos });
        } else {
          inst.dispatchAction({ type: 'showTip', seriesIndex: presenceSeriesIndex, dataIndex: bestIdx });
        }
      } else {
        inst.dispatchAction({ type: 'hideTip' });
      }
    } catch {}
  }, [selectedLogin, visRows, tick, winStart, winEnd, chartReady, nowMarkTs]);

  // Hover handlers to populate highlight overlay for the hovered user
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst || !chartReady) return;
    const updateHi = (loginKey) => {
      try {
        if (lastHoverLoginRef.current === loginKey) return;
        lastHoverLoginRef.current = loginKey;
        // Determine current window from xAxis
        let wStartH = null, wEndH = null;
        const optH = inst.getOption();
        const xaH = (optH && optH.xAxis && optH.xAxis[0]) || {};
        if (typeof xaH.min === 'number' && typeof xaH.max === 'number') { wStartH = xaH.min; wEndH = xaH.max; }
        const key = `${loginKey}|${wStartH}|${wEndH}`;
        let hi = hiCacheRef.current.get(key);
        if (!hi) {
          const arr = segmentsRef.current.get(loginKey) || [];
          const row = rowIndexMapRef.current.get(loginKey);
          if (!(typeof row === 'number')) return;
          const nowH = nowMarkTs;
          hi = [];
          for (let idx = 0; idx < arr.length; idx++) {
            const seg = arr[idx];
            if (typeof seg.start !== 'number') continue;
            const segEnd = (seg.end == null ? nowH : seg.end);
            let s0 = seg.start;
            let e0 = segEnd;
            if (typeof wStartH === 'number' && s0 < wStartH) s0 = wStartH;
            if (typeof wEndH === 'number' && e0 > wEndH) e0 = wEndH;
            if (s0 >= e0) continue;
            hi.push({ value: [s0, e0, row] });
          }
          hiCacheRef.current.set(key, hi);
        }
        inst.setOption({ series: [{ id: 'presence-hi', data: hi }] }, { notMerge: false });
      } catch {}
    };
    const onOver = (p) => {
      const it = Array.isArray(p) ? p[0] : p;
      if (!it || it.seriesName !== 'Presence') return;
      const loginKey = it.data && it.data.login;
      if (!loginKey) return;
      if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = requestAnimationFrame(() => updateHi(loginKey));
    };
    const onOut = () => {
      if (hoverRafRef.current) { cancelAnimationFrame(hoverRafRef.current); hoverRafRef.current = 0; }
      lastHoverLoginRef.current = null;
      try { inst.setOption({ series: [{ id: 'presence-hi', data: [] }] }, { notMerge: false }); } catch {}
    };
    inst.on('mouseover', onOver);
    inst.on('globalout', onOut);
    return () => {
      inst.off('mouseover', onOver);
      inst.off('globalout', onOut);
    };
  }, [chartReady, nowMarkTs]);

  // Click-to-select (persistent selection), independent of pin mode
  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst || !chartReady) return;
    const updateSel = (loginKey) => {
      try {
        // Determine current window from xAxis (upper grid)
        let wStartH = null, wEndH = null;
        const optH = inst.getOption();
        const xaH = (optH && Array.isArray(optH.xAxis) && optH.xAxis[0]) || {};
        if (typeof xaH.min === 'number' && typeof xaH.max === 'number') { wStartH = xaH.min; wEndH = xaH.max; }
        const key = `${loginKey}|${wStartH}|${wEndH}`;
        let hi = hiCacheRef.current.get(key);
        if (!hi) {
          const arr = segmentsRef.current.get(loginKey) || [];
          const row = rowIndexMapRef.current.get(loginKey);
          if (!(typeof row === 'number')) { hi = []; }
          else {
            const nowH = nowMarkTs;
            hi = [];
            for (let idx = 0; idx < arr.length; idx++) {
              const seg = arr[idx];
              if (typeof seg.start !== 'number') continue;
              const segEnd = (seg.end == null ? nowH : seg.end);
              let s0 = seg.start;
              let e0 = segEnd;
              if (typeof wStartH === 'number' && s0 < wStartH) s0 = wStartH;
              if (typeof wEndH === 'number' && e0 > wEndH) e0 = wEndH;
              if (s0 >= e0) continue;
              hi.push({ value: [s0, e0, row] });
            }
          }
          hiCacheRef.current.set(key, hi);
        }
        inst.setOption({ series: [{ id: 'presence-sel', data: hi }] }, { notMerge: false });
      } catch {}
    };
    const onClick = (p) => {
      try {
        if (pinMode) return;
        const d = p && p.data;
        const loginKey = d && d.login;
        if (!loginKey) return;
        // Update nav order snapshot based on actual on-screen y positions at current x midpoint
        const inst2 = chartInstance.current;
        const list = visRowsRef.current || [];
        const opt = inst2.getOption();
        const xa0 = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : null;
        const xMid = (typeof xa0?.min === 'number' && typeof xa0?.max === 'number') ? ((xa0.min + xa0.max) / 2) : Date.now();
        const items = [];
        for (let i = 0; i < list.length; i++) {
          const lg = list[i];
          const row = rowIndexMapRef.current.get(lg);
          if (typeof row !== 'number') continue;
          const px = inst2.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [xMid, row]);
          const py = Array.isArray(px) ? px[1] : Number.POSITIVE_INFINITY;
          items.push({ login: lg, py });
        }
        items.sort((a, b) => a.py - b.py);
        navListRef.current = items.map(it => it.login);
        navSnapRef.current = navListRef.current.slice();
        const multi = !!(p && p.event && ((p.event.event && p.event.event.shiftKey) || p.event.shiftKey));
        if (multi) {
          setSelectedLogins(prev => {
            const cur = Array.isArray(prev) ? prev.slice() : [];
            const idx = cur.indexOf(loginKey);
            if (idx === -1) cur.push(loginKey); else cur.splice(idx, 1);
            return cur;
          });
        } else {
          setSelectedLogins([loginKey]);
        }
        setSelectedLogin(loginKey);
        updateSel(loginKey);
      } catch {}
    };
    inst.on('click', onClick);
    return () => { inst.off('click', onClick); };
  }, [chartReady, nowMarkTs]);

  // Keyboard navigation (ArrowUp/ArrowDown) through visible users (supports Shift for multi-select)
  useEffect(() => {
    if (!chartReady) return;
    const handler = (e) => {
      try {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const ae = document.activeElement;
        if (ae && ((ae.tagName === 'INPUT') || (ae.tagName === 'TEXTAREA') || (ae.getAttribute && ae.getAttribute('contenteditable') === 'true'))) return;
        // No order locking needed; sort is stable
        // Use stable snapshot during Arrow navigation; create on first use if missing
        if (!navSnapRef.current || navSnapRef.current.length === 0) {
          try {
            const inst2 = chartInstance.current;
            const list = visRowsRef.current || [];
            const opt = inst2.getOption();
            const xa0 = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : null;
            const xMid = (typeof xa0?.min === 'number' && typeof xa0?.max === 'number') ? ((xa0.min + xa0.max) / 2) : Date.now();
            const items = [];
            for (let i = 0; i < list.length; i++) {
              const lg = list[i];
              const row = rowIndexMapRef.current.get(lg);
              if (typeof row !== 'number') continue;
              const px = inst2.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [xMid, row]);
              const py = Array.isArray(px) ? px[1] : Number.POSITIVE_INFINITY;
              items.push({ login: lg, py });
            }
            items.sort((a, b) => a.py - b.py);
            navListRef.current = items.map(it => it.login);
            const fallback = (visRowsRef.current || []).slice();
            navSnapRef.current = (navListRef.current && navListRef.current.length) ? navListRef.current.slice() : fallback;
          } catch {
            navListRef.current = (visRowsRef.current || []).slice();
            navSnapRef.current = navListRef.current.slice();
          }
        }
        let list = navSnapRef.current || [];
        const visSet = new Set(visRowsRef.current || []);
        const filtered = list.filter(lg => visSet.has(lg));
        if (filtered.length !== list.length) {
          list = filtered;
          navSnapRef.current = filtered.slice();
        }
        if (list.length === 0) return;
        const cur = selectedLoginRef.current;
        let idx = cur ? list.indexOf(cur) : -1;
        if (idx === -1) idx = (e.key === 'ArrowUp') ? (list.length - 1) : 0;
        if (e.key === 'ArrowUp') idx = Math.max(0, idx - 1);
        else if (e.key === 'ArrowDown') idx = Math.min(list.length - 1, idx + 1);
        const next = list[idx];
        if (!next) return;
        const multi = !!e.shiftKey;
        if (multi) {
          setSelectedLogins(prev => {
            const cur = Array.isArray(prev) ? prev.slice() : [];
            if (!cur.includes(next)) cur.push(next);
            return cur;
          });
        } else {
          setSelectedLogins([next]);
        }
        setSelectedLogin(next);
        // Update selection series (multi)
        const inst = chartInstance.current;
        if (!inst) return;
        // mimic updateSel from above (multi)
        let wStartH = null, wEndH = null;
        const optH = inst.getOption();
        const xaH = (optH && Array.isArray(optH.xAxis) && optH.xAxis[0]) || {};
        if (typeof xaH.min === 'number' && typeof xaH.max === 'number') { wStartH = xaH.min; wEndH = xaH.max; }
        const picks = multi ? (selectedLoginsRef.current || []).concat(next) : [next];
        const set = new Set(picks);
        const nowH = nowMarkTs;
        let all = [];
        for (const lg of set) {
          const key = `${lg}|${wStartH}|${wEndH}`;
          let hi = hiCacheRef.current.get(key);
          if (!hi) {
            const arr = segmentsRef.current.get(lg) || [];
            const row = rowIndexMapRef.current.get(lg);
            if (!(typeof row === 'number')) { hi = []; }
            else {
              hi = [];
              for (let idx2 = 0; idx2 < arr.length; idx2++) {
                const seg = arr[idx2];
                if (typeof seg.start !== 'number') continue;
                const segEnd = (seg.end == null ? nowH : seg.end);
                let s0 = seg.start; let e0 = segEnd;
                if (typeof wStartH === 'number' && s0 < wStartH) s0 = wStartH;
                if (typeof wEndH === 'number' && e0 > wEndH) e0 = wEndH;
                if (s0 >= e0) continue;
                hi.push({ value: [s0, e0, row] });
              }
            }
            hiCacheRef.current.set(key, hi);
          }
          if (Array.isArray(hi) && hi.length) all.push(...hi);
        }
        inst.setOption({ series: [{ id: 'presence-sel', data: all }] }, { notMerge: false });
        e.preventDefault();
        e.stopPropagation();
      } catch {}
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chartReady, visRows, nowMarkTs]);

  // Clear snapshot when sort mode changes or selection cleared
  useEffect(() => { navSnapRef.current = null; }, [sortMode]);
  useEffect(() => { if (!selectedLogin && (!selectedLogins || selectedLogins.length === 0)) { navSnapRef.current = null; } }, [selectedLogin, selectedLogins]);

  // Click outside chart/details clears selection
  useEffect(() => {
    const handler = (e) => {
      try {
        const elChart = chartRef.current; const elDetails = detailsRef.current;
        const t = e && (e.target || null);
        if (elChart && t && elChart.contains(t)) return;
        if (elDetails && t && elDetails.contains(t)) return;
        if (selectedLoginRef.current || (selectedLoginsRef.current && selectedLoginsRef.current.length)) {
          setSelectedLogin(null);
          setSelectedLogins([]);
          navSnapRef.current = null;
        }
      } catch {}
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [chartReady]);

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
        <Text>Timezone:</Text>
        <Code>{timeZone === 'system' ? 'System' : timeZone}</Code>
        <Button variant="soft" onClick={() => setTzEditing(true)}>Change</Button>
        <Button variant={showDebug ? 'solid' : 'soft'} onClick={() => setShowDebug(v => !v)}>Debug</Button>
        <Button variant="soft" color="gray" onClick={exportPresenceJson}>Export JSON</Button>
        <Button variant="soft" color="gray" onClick={importPresenceJson}>Import JSON</Button>
        <Button variant="soft" color="red" onClick={clearChatterAndSessions}>Clear chatter + sessions</Button>
        {/* Capture chat messages and Show chat dots controls removed; always on */}
        <Button
          variant="soft"
          onClick={() => setFilterMode(m => (m === 'all' ? 'present' : (m === 'present' ? 'messagers' : 'all')))}
        >{`Filter: ${filterMode === 'all' ? 'all' : (filterMode === 'present' ? 'in chat now' : 'messagers')}`}</Button>
        <Button
          variant="soft"
          color="indigo"
          onClick={() => setSortMode(m => (m === 'default' ? 'time' : (m === 'time' ? 'ins' : 'default')))}
        >{`Sort: ${sortMode === 'time' ? 'time in room' : (sortMode === 'ins' ? 'INs' : 'ins/outs')}`}</Button>
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
        >{`Fit: ${fitMode ? 'All' : 'Partial'}`}</Button>
        <Button variant={pinMode ? 'solid' : 'soft'} color="indigo" onClick={() => setPinMode(v => !v)}>Pin mode</Button>
        <TextField.Root value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users" />
      </Flex>
      {tzEditing && (
        <Box mt="2">
          <Flex align="center" gap="2" wrap="wrap">
            <TextField.Root value={tzInput} onChange={e => setTzInput(e.target.value)} placeholder="e.g. Los Angeles, PST, Europe/Paris" />
            <Button variant="soft" onClick={() => applyTz(tzInput.trim())}>Set TZ</Button>
            <Button variant="soft" color="gray" onClick={() => setTzEditing(false)}>Cancel</Button>
            <Button variant={timeZone==='UTC' ? 'solid' : 'soft'} onClick={() => applyTz('UTC')}>UTC</Button>
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
      <Box mt="3" style={{ height: 900 }}>
        <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
      </Box>
      {Array.isArray(selectedLogins) && selectedLogins.length > 0 && (
        <Box ref={detailsRef} mt="3">
          <Heading size="4">Selection</Heading>
          <Flex mt="2" gap="2" wrap="wrap" align="start" justify="start">
            {selectedLogins.map((lg) => {
              const uname = (namesRef.current.get(lg) || lg);
              const arr = segmentsRef.current.get(lg) || [];
              const last = arr[arr.length - 1];
              const present = !!(last && last.end == null);
              let lastVisit = null;
              if (arr.length > 0) {
                const l = arr[arr.length - 1];
                lastVisit = (l.end == null) ? l.start : l.end;
              }
              // Current window
              let wStartH = null, wEndH = null;
              try {
                const inst = chartInstance.current; const opt = inst && inst.getOption();
                const xa = (opt && Array.isArray(opt.xAxis) && opt.xAxis[0]) || {};
                if (typeof xa.min === 'number' && typeof xa.max === 'number') { wStartH = xa.min; wEndH = xa.max; }
              } catch {}
              // Time in window
              const nowH = nowMarkTs;
              let winMs = 0;
              if (typeof wStartH === 'number' && typeof wEndH === 'number') {
                for (const seg of arr) {
                  if (typeof seg.start !== 'number') continue;
                  const s = Math.max(wStartH, seg.start);
                  const e = Math.min(wEndH, seg.end == null ? nowH : seg.end);
                  if (e > s) winMs += (e - s);
                }
              }
              // Messages in window
              const msgsAll = messagesRef.current.get(lg) || [];
              const msgsWin = [];
              if (typeof wStartH === 'number' && typeof wEndH === 'number') {
                for (const m of msgsAll) { const t = m && m.t; if (typeof t === 'number' && t >= wStartH && t <= wEndH) msgsWin.push(m); }
              } else {
                for (const m of msgsAll) { if (m && typeof m.t === 'number') msgsWin.push(m); }
              }
              msgsWin.sort((a, b) => (a.t || 0) - (b.t || 0));
              const msgCount = msgsWin.length;

              // Session metrics (based on selected session)
              let sessStart = null, sessEnd = null;
              let sessMs = 0, sessFirst = null, sessLast = null, sessVisits = 0, sessMsgCount = 0;
              let sessIsLive = false;
              if (selectedSessionId && selectedSessionId !== 'offline' && Array.isArray(sessions)) {
                const meta = sessions.find(s => s && s.id === selectedSessionId);
                if (meta) {
                  sessStart = (typeof meta.start === 'number') ? meta.start : (Date.parse(meta.id) || null);
                  sessEnd = (typeof meta.end === 'number') ? meta.end : nowH;
                  sessIsLive = !(typeof meta.end === 'number');
                  if (sessStart != null && sessEnd != null && sessEnd > sessStart) {
                    for (const seg of arr) {
                      if (typeof seg.start !== 'number') continue;
                      const s = Math.max(sessStart, seg.start);
                      const e = Math.min(sessEnd, seg.end == null ? nowH : seg.end);
                      if (e > s) {
                        sessMs += (e - s);
                        sessVisits += 1;
                        if (sessFirst == null || s < sessFirst) sessFirst = s;
                        if (sessLast == null || e > sessLast) sessLast = e;
                      }
                    }
                    for (const m of msgsAll) { const t = m && m.t; if (typeof t === 'number' && t >= sessStart && t <= sessEnd) sessMsgCount++; }
                  }
                }
              }
              return (
                <Card key={lg} style={{ width: '100%', maxWidth: '100%', flex: '1 1 100%', display: 'block' }}>
                  <Heading size="3">{uname}</Heading>
                  <Text as="div" color="gray">{lg}</Text>
                  <Separator my="2" />
                  <Text as="div">Present: <Code>{present ? 'yes' : 'no'}</Code></Text>
                  {lastVisit != null && (<Text as="div">Last change: <Code>{dtfFull.format(lastVisit)}</Code></Text>)}
                  {(typeof wStartH === 'number' && typeof wEndH === 'number') && (
                    <Text as="div">Time in window: <Code>{fmtShortDur(winMs)}</Code></Text>
                  )}
                  {(sessStart != null && sessEnd != null) && (
                    <>
                      <Separator my="2" />
                      <Text as="div">Session: <Code>{dtfFull.format(sessStart)} → {sessIsLive ? 'LIVE' : dtfFull.format(sessEnd)}</Code></Text>
                      <Text as="div">Time in session: <Code>{fmtShortDur(sessMs)}</Code></Text>
                      {sessFirst != null && (<Text as="div">First in session: <Code>{dtfFull.format(sessFirst)}</Code></Text>)}
                      {sessLast != null && (<Text as="div">Last in session: <Code>{dtfFull.format(sessLast)}</Code></Text>)}
                      <Text as="div">Visits in session: <Code>{sessVisits}</Code></Text>
                      <Text as="div">Messages (session): <Code>{sessMsgCount}</Code></Text>
                    </>
                  )}
                  <Text as="div">Messages{(typeof wStartH==='number'&&typeof wEndH==='number')?' (window)':''}: <Code>{msgCount}</Code></Text>
                  {msgCount > 0 && (
                    <Box mt="2" style={{ maxHeight: 200, width: '100%', overflow: 'auto', border: '1px solid var(--gray-6)', borderRadius: 6, padding: 6, whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', lineHeight: 1.2 }}>
                      {msgsWin.map((m, idx) => (
                        <Text as="div" key={m.id || `${m.t || 0}-${idx}`} style={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{dtfFull.format(m.t)} — {String(m.txt || '')}</Text>
                      ))}
                    </Box>
                  )}
                </Card>
              );
            })}
          </Flex>
        </Box>
      )}
      <Box mt="3" style={{ height: 180 }}>
        <div ref={distChartRef} style={{ width: '100%', height: '100%' }} />
      </Box>
    </Card>
  );
}
