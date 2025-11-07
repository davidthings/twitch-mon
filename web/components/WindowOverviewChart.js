import React, { useEffect, useRef, useState } from 'react';

export default function WindowOverviewChart({
  timeZone,
  segmentsRef,
  sessions,
  winStart,
  winEnd,
  fitMode,
  onRangeChange,
}) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  function isValidTZ(tz) {
    if (!tz || tz === 'system') return true;
    try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
  }

  const tzResolved = timeZone === 'system' ? undefined : (isValidTZ(timeZone) ? timeZone : undefined);
  const dtfFull = new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dtfTick = new Intl.DateTimeFormat(undefined, { timeZone: tzResolved, hour: '2-digit', minute: '2-digit' });

  function getDataExtent(now) {
    const segs = segmentsRef && segmentsRef.current;
    if (!segs || segs.size === 0) return null;
    let min = Infinity;
    let max = -Infinity;
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

  const [legend, setLegend] = useState({ left: '', right: '' });

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
      const ext = getDataExtent(now);
      const PRE_PAD = 30 * 60 * 1000;
      const LIVE_PAD = 5 * 60 * 1000;
      const minX = ext ? (ext.min - PRE_PAD) : (now - 3 * 60 * 60 * 1000);
      const maxX = ext ? (ext.max + LIVE_PAD) : (now + LIVE_PAD);
      inst.setOption({
        animation: false,
        grid: [{ left: 40, right: 56, top: 8, bottom: 40, containLabel: true }],
        axisPointer: { label: { formatter: (obj) => {
          try {
            const raw = obj && obj.value;
            const val = Array.isArray(raw) ? raw[0] : raw;
            if (typeof val === 'number' && isFinite(val)) return dtfFull.format(val);
            if (typeof val === 'string') { const t = Date.parse(val); if (!Number.isNaN(t)) return dtfFull.format(t); }
            return String(val ?? '');
          } catch { return ' '; }
        } } },
        tooltip: { show: false },
        xAxis: [{ type: 'time', boundaryGap: false, min: minX, max: maxX, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false } }],
        yAxis: [{ type: 'value', show: false }],
        dataZoom: [{
          type: 'slider',
          show: true,
          xAxisIndex: [0],
          filterMode: 'none',
          throttle: 100,
          height: 24,
          bottom: 4,
          brushSelect: false,
          showDetail: true,
          labelFormatter: (val) => { try { return (typeof val === 'number' && isFinite(val)) ? dtfFull.format(val) : ''; } catch { return ''; } },
          startValue: (typeof winStart === 'number' ? winStart : minX),
          endValue: (typeof winEnd === 'number' ? winEnd : maxX),
        }],
        series: []
      });
      try {
        const left = ext ? dtfFull.format(ext.min) : dtfFull.format(minX);
        const right = dtfFull.format(now);
        setLegend({ left, right });
      } catch {}
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => inst.resize()); else setTimeout(() => inst.resize(), 0);
      const handler = (params) => {
        try {
          const dz = params && (params.batch ? params.batch[0] : params) || {};
          let s = (typeof dz.startValue === 'number') ? dz.startValue : null;
          let e = (typeof dz.endValue === 'number') ? dz.endValue : null;
          const opt = inst.getOption();
          if (s == null || e == null) {
            const dz0 = opt && opt.dataZoom && opt.dataZoom[0];
            if (dz0) { s = dz0.startValue; e = dz0.endValue; }
          }
          if (!(typeof s === 'number' && typeof e === 'number' && e > s)) return;
          const SNAP_MS = 60 * 1000;
          let ss = s, ee = e;
          if (Array.isArray(sessions)) {
            const bounds = [];
            for (const meta of sessions) {
              if (meta && typeof meta.start === 'number') bounds.push(meta.start);
              if (meta && typeof meta.end === 'number') bounds.push(meta.end);
            }
            const snap = (val) => {
              let best = val, bestD = SNAP_MS + 1;
              for (const b of bounds) { if (typeof b !== 'number') continue; const d = Math.abs(val - b); if (d < bestD) { bestD = d; best = b; } }
              return bestD <= SNAP_MS ? best : val;
            };
            ss = snap(s); ee = snap(e);
            if (!(ee > ss)) { ee = e; ss = e; }
          }
          const now2 = Date.now();
          const ext = getDataExtent(now2);
          const LIVE_PAD = 5 * 60 * 1000;
          let fullMax = ee;
          if (ext) fullMax = ext.max + LIVE_PAD;
          const atRight = typeof fullMax === 'number' && Math.abs(ee - fullMax) <= SNAP_MS;
          if (typeof onRangeChange === 'function') onRangeChange(ss, ee, atRight);
        } catch {}
      };
      inst.on('dataZoom', handler);
      return () => { window.removeEventListener('resize', handleResize); inst.off('dataZoom', handler); inst.dispose(); };
    }
    const cleanup = init();
    return () => { disposed = true; Promise.resolve(cleanup).then(fn => fn && fn()); };
  }, [timeZone]);

  useEffect(() => {
    const inst = chartInstance.current;
    if (!inst) return;
    const now = Date.now();
    const ext = getDataExtent(now);
    const PRE_PAD = 30 * 60 * 1000;
    const LIVE_PAD = 5 * 60 * 1000;
    const fullMin = ext ? (ext.min - PRE_PAD) : (now - 3 * 60 * 60 * 1000);
    const fullMax = ext ? (ext.max + LIVE_PAD) : (now + LIVE_PAD);
    let selStart = winStart, selEnd = winEnd;
    if (fitMode && ext) { selStart = fullMin; selEnd = fullMax; }
    inst.setOption({
      xAxis: [{ type: 'time', boundaryGap: false, min: fullMin, max: fullMax, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false } }],
      dataZoom: [{
        type: 'slider', show: true, xAxisIndex: [0], filterMode: 'none', throttle: 100, height: 24, bottom: 4, brushSelect: false,
        startValue: (typeof selStart === 'number' ? selStart : fullMin), endValue: (typeof selEnd === 'number' ? selEnd : fullMax),
        labelFormatter: (val) => { try { return (typeof val === 'number' && isFinite(val)) ? dtfFull.format(val) : ''; } catch { return ''; } },
      }],
      series: []
    }, { notMerge: false });
    try {
      const left = ext ? dtfFull.format(ext.min) : dtfFull.format(fullMin);
      const right = dtfFull.format(Date.now());
      setLegend({ left, right });
    } catch {}
    inst.resize();
  }, [segmentsRef?.current, sessions?.length, winStart, winEnd, fitMode]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={chartRef} style={{ width: '100%', flex: 1 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: 'var(--gray-11)' }}>
        <span>{legend.left}</span>
        <span>{legend.right}</span>
      </div>
    </div>
  );
}
