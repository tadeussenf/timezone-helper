// Timezone Planner — main app
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const HOUR_PX = 52;
const HEADER_PX = 92;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "workStart": 9,
  "workEnd": 18,
  "clock24h": true,
  "weekendsHighlighted": true,
  "showNowLine": true,
  "hoverSync": true
}/*EDITMODE-END*/;

// ——— Time helpers (use Intl for real offset math) ———

function getParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  // parse into numeric
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  return {
    weekday: parts.weekday,
    month: parts.month,
    day: parseInt(parts.day, 10),
    year: parseInt(parts.year, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

function getOffsetMinutes(date, timeZone) {
  // Offset from UTC in minutes for this zone at this instant
  const local = getParts(date, timeZone);
  const utc = getParts(date, "UTC");
  const localMs = Date.UTC(local.year, monthIndex(local.month), local.day, local.hour, local.minute, local.second);
  const utcMs = Date.UTC(utc.year, monthIndex(utc.month), utc.day, utc.hour, utc.minute, utc.second);
  return Math.round((localMs - utcMs) / 60000);
}

function monthIndex(abbr) {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(abbr);
}

function formatOffset(mins) {
  const sign = mins >= 0 ? "+" : "−";
  const a = Math.abs(mins);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return m === 0 ? `GMT${sign}${h}` : `GMT${sign}${h}:${String(m).padStart(2, "0")}`;
}

function formatDiff(mins) {
  if (mins === 0) return "same";
  const sign = mins > 0 ? "+" : "−";
  const a = Math.abs(mins);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${m}m`;
}

function formatHour(h, clock24) {
  if (clock24) return String(h).padStart(2, "0") + ":00";
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function formatTime(h, m, clock24) {
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  if (clock24) return `${hh}:${mm}`;
  const meridiem = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${meridiem}`;
}

// ——— Core data: compute a 24-hour grid for each zone, anchored to "home" day ———
// Grid is aligned: row N across all columns represents the SAME instant.
// Home zone's row 0 = midnight at home on `anchorDate`.
function computeGrid(anchorDate, homeZone, zones) {
  // Anchor midnight in the home zone
  // Strategy: take `anchorDate` (a Date), get its Y/M/D in home zone, then build
  // an instant for 00:00 in that home zone.
  const homeParts = getParts(anchorDate, homeZone.id);
  const homeMidnightUtcGuess = Date.UTC(homeParts.year, monthIndex(homeParts.month), homeParts.day, 0, 0, 0);
  // Adjust: we need an instant such that viewing it in homeZone shows 00:00 on that date.
  // Find offset at that guess and subtract.
  const offsetAtGuess = getOffsetMinutes(new Date(homeMidnightUtcGuess), homeZone.id);
  const homeMidnightMs = homeMidnightUtcGuess - offsetAtGuess * 60000;

  // For each zone, produce 24 hourly instants + metadata
  return zones.map(zone => {
    const hours = [];
    for (let i = 0; i < 24; i++) {
      const instant = new Date(homeMidnightMs + i * 3600000);
      const parts = getParts(instant, zone.id);
      hours.push({
        instant,
        hour: parts.hour,
        minute: parts.minute,
        weekday: parts.weekday,
        day: parts.day,
        month: parts.month,
      });
    }
    return { zone, hours };
  });
}

function isWeekend(weekday) {
  return weekday === "Sat" || weekday === "Sun";
}

function hourBand(hour, workStart, workEnd) {
  // Night starts at 00:00 and runs until work hours begin
  if (hour < workStart) return "night";
  if (hour < workEnd) return "work";
  return "evening";
}

// ——— Icons ———
const Icon = {
  Plus: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>,
  Search: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="14" height="14"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L13 13"/></svg>,
  X: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8"/></svg>,
  Copy: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V4a1 1 0 0 1 1-1h7"/></svg>,
  Share: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="8" r="1.8"/><circle cx="12" cy="4" r="1.8"/><circle cx="12" cy="12" r="1.8"/><path d="M5.5 7l5-2M5.5 9l5 2"/></svg>,
  Check: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>,
  Calendar: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2.5" y="4" width="11" height="9.5" rx="1.5"/><path d="M2.5 7h11M5.5 2.5v3M10.5 2.5v3"/></svg>,
  Chevron: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4"/></svg>,
  Trash: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 5h10M6 5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V5M4.5 5l.5 8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8"/></svg>,
  Sparkle: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.5 4.5L6 6M12 12l-1.5-1.5M4.5 11.5L6 10M12 4l-1.5 1.5"/></svg>,
};

// ——— Add Zone Modal ———
function AddZoneModal({ open, onClose, onAdd, activeKeys, now }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef();

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    if (!open) setQuery("");
  }, [open]);

  const results = useMemo(() => {
    if (!query) return ZONE_CATALOG;
    const q = query.toLowerCase();
    return ZONE_CATALOG.filter(z =>
      z.city.toLowerCase().includes(q) ||
      z.region.toLowerCase().includes(q) ||
      z.code.toLowerCase().includes(q) ||
      z.id.toLowerCase().includes(q)
    );
  }, [query]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">Add timezone</h3>
          <p className="modal-sub">Search cities or regions, or pick from popular zones.</p>
        </div>
        <div className="search-wrap">
          <span className="search-icon"><Icon.Search/></span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Search Tokyo, Europe, GMT+5…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {!query && (
          <div className="quick-picks">
            <div className="qp-label">Quick picks</div>
            {QUICK_PICKS.map(k => {
              const z = ZONE_CATALOG.find(z => z.key === k);
              if (!z) return null;
              const added = activeKeys.includes(k);
              return (
                <button
                  key={k}
                  className={`qp-btn ${added ? "added" : ""}`}
                  onClick={() => !added && onAdd(k)}
                >
                  {z.city} {added && "✓"}
                </button>
              );
            })}
          </div>
        )}
        <div className="search-results">
          {results.length === 0 && (
            <div style={{padding: "20px", textAlign: "center", color: "var(--ink-3)", fontSize: 13}}>
              No zones matching "{query}".
            </div>
          )}
          {results.map(z => {
            const offset = getOffsetMinutes(now, z.id);
            const parts = getParts(now, z.id);
            const added = activeKeys.includes(z.key);
            return (
              <div
                key={z.key}
                className="search-result"
                onClick={() => !added && onAdd(z.key)}
                style={added ? {cursor: "default", opacity: 0.7} : {}}
              >
                <div className="sr-flag">{z.code}</div>
                <div className="sr-main">
                  <div className="sr-city">{z.city}</div>
                  <div className="sr-region">{z.region} · {z.id}</div>
                </div>
                <div className="sr-time">
                  {formatTime(parts.hour, parts.minute, true)}
                  <span className="diff">{formatOffset(offset)}</span>
                </div>
                {added && <div className="sr-added">Added</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ——— One zone column ———
function ZoneColumn({ zoneData, isHome, homeOffsetMins, onRemove, settings,
                      hoverHour, onHoverHour, onHoverClear,
                      dragStart, dragEnd, onMouseDownHour, onMouseEnterHour,
                      meeting, now, setHome }) {
  const { zone, hours } = zoneData;
  const offset = getOffsetMinutes(now, zone.id);
  const diffMins = offset - homeOffsetMins;
  const localParts = getParts(now, zone.id);

  // find day turns (when hour moves from 23→0 within the 24-row column)
  const firstDay = hours[0].day;
  const firstWeekday = hours[0].weekday;
  const firstMonth = hours[0].month;

  // label for header date
  const dateLabel = `${firstWeekday} ${firstMonth} ${firstDay}`;

  // Now line offset in px (within the 24h column) — only if the current instant
  // falls inside this column's range.
  const firstInstant = hours[0].instant.getTime();
  const lastInstant = hours[23].instant.getTime() + 3600000;
  const nowMs = now.getTime();
  let nowTopPx = null;
  if (settings.showNowLine && nowMs >= firstInstant && nowMs < lastInstant) {
    const elapsed = (nowMs - firstInstant) / 3600000;
    nowTopPx = elapsed * HOUR_PX;
  }

  // Meeting block in this column (meeting = {startIdx, endIdx} in home-row indices)
  let meetingTop = null, meetingHeight = null, meetingTimeLabel = "", meetingDurLabel = "";
  if (meeting) {
    const lo = Math.min(meeting.startIdx, meeting.endIdx);
    const hi = Math.max(meeting.startIdx, meeting.endIdx);
    meetingTop = lo * HOUR_PX + 2;
    meetingHeight = (hi - lo + 1) * HOUR_PX - 4;
    const startH = hours[lo];
    const endH = hours[hi];
    if (startH && endH) {
      meetingTimeLabel = `${formatTime(startH.hour, 0, settings.clock24h)}–${formatTime((endH.hour + 1) % 24, 0, settings.clock24h)}`;
      meetingDurLabel = `${hi - lo + 1}h · ${startH.weekday}`;
    }
  }

  // Drag preview in home-row indices
  let dragTop = null, dragHeight = null;
  if (dragStart !== null && dragEnd !== null) {
    const lo = Math.min(dragStart, dragEnd);
    const hi = Math.max(dragStart, dragEnd);
    dragTop = lo * HOUR_PX + 2;
    dragHeight = (hi - lo + 1) * HOUR_PX - 4;
  }

  return (
    <div className={`col ${isHome ? "is-home" : ""}`}>
      <div className="col-header">
        <div className="col-header-row">
          <span className="col-flag" title={zone.emoji}>{zone.code}</span>
          <span className="col-city" onClick={() => setHome(zone.key)} style={{cursor: "pointer"}} title="Set as home">
            {zone.city}
          </span>
          {!isHome && (
            <button className="col-remove" onClick={() => onRemove(zone.key)} title="Remove">
              <Icon.X/>
            </button>
          )}
        </div>
        <div>
          <div className="col-meta">
            <span className="col-time">
              {formatTime(localParts.hour, localParts.minute, settings.clock24h)}
              <span className="secs">:{String(localParts.second).padStart(2, "0")}</span>
            </span>
            {isHome && <span className="chip" style={{padding: "2px 7px", fontSize: 10}}>
              <span className="chip-dot"/>HOME
            </span>}
          </div>
          <div className="col-meta" style={{marginTop: 3, gap: 6}}>
            <span className="col-date">{dateLabel}</span>
            <span className="col-offset">
              {formatOffset(offset)}
              {!isHome && <> · <span className={`diff ${diffMins < 0 ? "behind" : ""}`}>{formatDiff(diffMins)}</span></>}
            </span>
            {zone.dst && <span className="col-dst" title="Observes daylight saving time">DST</span>}
          </div>
        </div>
      </div>
      <div className="col-body" style={{position: "relative"}}>
        {hours.map((h, idx) => {
          const band = hourBand(h.hour, settings.workStart, settings.workEnd);
          const weekendCls = settings.weekendsHighlighted && isWeekend(h.weekday) ? "weekend" : "";
          const dayTurn = idx > 0 && h.hour === 0 ? "dayturn" : "";
          const isSource = hoverHour !== null && idx === hoverHour && isHome;
          const isSync = hoverHour !== null && idx === hoverHour && !isHome && settings.hoverSync;
          return (
            <div
              key={idx}
              className={`hour ${band} ${weekendCls} ${dayTurn} ${isSource ? "hover-source" : ""} ${isSync ? "hover-sync" : ""}`}
              data-newday={dayTurn ? `${h.weekday} ${h.day}` : ""}
              onMouseEnter={() => {
                onHoverHour(idx);
                onMouseEnterHour(idx);
              }}
              onMouseLeave={onHoverClear}
              onMouseDown={(e) => { e.preventDefault(); onMouseDownHour(idx); }}
            >
              <span className="hour-label">
                {formatHour(h.hour, settings.clock24h)}
              </span>
            </div>
          );
        })}

        {nowTopPx !== null && (
          <div className="now-line" style={{top: nowTopPx}}>
            <div className="now-badge">NOW</div>
          </div>
        )}

        {dragStart !== null && dragEnd !== null && (
          <div className="drag-preview" style={{top: dragTop, height: dragHeight}}/>
        )}

        {meeting && meetingTop !== null && (
          <div className="meeting-block" style={{top: meetingTop, height: meetingHeight}}>
            <div className="meeting-label">{meetingTimeLabel}</div>
            <div className="meeting-dur">{meetingDurLabel}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ——— Tweaks Panel ———
function TweaksPanel({ settings, setSettings, visible }) {
  if (!visible) return null;
  const setKey = (k, v) => {
    setSettings(s => ({...s, [k]: v}));
    try {
      window.parent.postMessage({type: '__edit_mode_set_keys', edits: {[k]: v}}, '*');
    } catch(e) {}
  };
  return (
    <div className="tweaks">
      <h4>Tweaks</h4>
      <div className="tweak-row">
        <label>Clock</label>
        <select value={settings.clock24h ? "24" : "12"}
                onChange={e => setKey("clock24h", e.target.value === "24")}>
          <option value="24">24-hour</option>
          <option value="12">12-hour</option>
        </select>
      </div>
      <div className="tweak-row">
        <label>Work start</label>
        <select value={settings.workStart}
                onChange={e => setKey("workStart", parseInt(e.target.value))}>
          {[6,7,8,9,10].map(h => <option key={h} value={h}>{h}:00</option>)}
        </select>
      </div>
      <div className="tweak-row">
        <label>Work end</label>
        <select value={settings.workEnd}
                onChange={e => setKey("workEnd", parseInt(e.target.value))}>
          {[16,17,18,19,20].map(h => <option key={h} value={h}>{h}:00</option>)}
        </select>
      </div>
      <div className="tweak-row">
        <label>Hover sync</label>
        <div className={`switch ${settings.hoverSync ? "on" : ""}`}
             onClick={() => setKey("hoverSync", !settings.hoverSync)}/>
      </div>
      <div className="tweak-row">
        <label>Weekend shading</label>
        <div className={`switch ${settings.weekendsHighlighted ? "on" : ""}`}
             onClick={() => setKey("weekendsHighlighted", !settings.weekendsHighlighted)}/>
      </div>
      <div className="tweak-row">
        <label>"Now" line</label>
        <div className={`switch ${settings.showNowLine ? "on" : ""}`}
             onClick={() => setKey("showNowLine", !settings.showNowLine)}/>
      </div>
    </div>
  );
}

// ——— Main App ———
function App() {
  const STORAGE_KEY = "meridian.tz.v1";
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;
      const validKeys = new Set(ZONE_CATALOG.map(z => z.key));
      const active = Array.isArray(data.activeKeys) ? data.activeKeys.filter(k => validKeys.has(k)) : [];
      const home = validKeys.has(data.homeKey) ? data.homeKey : null;
      if (!home || active.length === 0) return null;
      return { homeKey: home, activeKeys: active };
    } catch { return null; }
  };

  // Detect user's home zone (used only if nothing saved)
  const detectedHome = useMemo(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const hit = ZONE_CATALOG.find(z => z.id === tz && !z.alias);
      return hit?.key || "BER";
    } catch { return "BER"; }
  }, []);

  const saved = useMemo(loadSaved, []);
  const [homeKey, setHomeKey] = useState(saved?.homeKey || detectedHome);
  const [activeKeys, setActiveKeys] = useState(() => {
    if (saved) return saved.activeKeys;
    const seed = [detectedHome, "LA", "NYC", "TYO"];
    return seed.filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  });

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ homeKey, activeKeys }));
    } catch {}
  }, [homeKey, activeKeys]);

  // Make sure home is first and present
  useEffect(() => {
    setActiveKeys(keys => {
      const withHome = keys.includes(homeKey) ? keys : [homeKey, ...keys];
      return [homeKey, ...withHome.filter(k => k !== homeKey)];
    });
  }, [homeKey]);

  const [settings, setSettings] = useState(TWEAK_DEFAULTS);
  const [tweaksVisible, setTweaksVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [hoverHour, setHoverHour] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [meeting, setMeeting] = useState(null);
  const [toast, setToast] = useState(null);
  const scrollRef = useRef();
  const railScrollRef = useRef();

  // Tick clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tweak mode hookup
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "__activate_edit_mode") setTweaksVisible(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksVisible(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({type: "__edit_mode_available"}, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  // Sync rail scroll with columns scroll
  const onColumnsScroll = useCallback((e) => {
    if (railScrollRef.current) {
      railScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  // Scroll to working hours on load
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, (settings.workStart - 1) * HOUR_PX);
    }
    // eslint-disable-next-line
  }, []);

  const homeZone = useMemo(() => ZONE_CATALOG.find(z => z.key === homeKey) || ZONE_CATALOG[0], [homeKey]);
  const zones = useMemo(
    () => activeKeys.map(k => ZONE_CATALOG.find(z => z.key === k)).filter(Boolean),
    [activeKeys]
  );
  const grids = useMemo(
    () => computeGrid(anchorDate, homeZone, zones),
    [anchorDate, homeZone, zones]
  );
  const homeOffsetMins = useMemo(() => getOffsetMinutes(now, homeZone.id), [now, homeZone]);

  // Add / remove (by key)
  const addZone = (k) => {
    if (!activeKeys.includes(k)) setActiveKeys([...activeKeys, k]);
    setModalOpen(false);
  };
  const removeZone = (k) => {
    if (k === homeKey) return;
    setActiveKeys(activeKeys.filter(x => x !== k));
  };
  const setHome = (k) => {
    setHomeKey(k);
  };

  // Hover + drag handlers
  const onHoverHour = (idx) => {
    setHoverHour(idx);
    if (isDragging) setDragEnd(idx);
  };
  const onHoverClear = () => {
    if (!isDragging) setHoverHour(null);
  };
  const onMouseDownHour = (idx) => {
    setIsDragging(true);
    setDragStart(idx);
    setDragEnd(idx);
    setMeeting(null);
  };
  const onMouseEnterHour = (idx) => {
    if (isDragging) setDragEnd(idx);
  };
  useEffect(() => {
    const up = () => {
      if (isDragging && dragStart !== null && dragEnd !== null) {
        setMeeting({ startIdx: dragStart, endIdx: dragEnd });
      }
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [isDragging, dragStart, dragEnd]);

  // Meeting actions
  const clearMeeting = () => setMeeting(null);
  const copyMeeting = async () => {
    if (!meeting) return;
    const lo = Math.min(meeting.startIdx, meeting.endIdx);
    const hi = Math.max(meeting.startIdx, meeting.endIdx);
    const lines = ["Meeting time across zones:"];
    grids.forEach(g => {
      const s = g.hours[lo];
      const e = g.hours[hi];
      const endH = (e.hour + 1) % 24;
      lines.push(`• ${g.zone.city}: ${s.weekday} ${s.month} ${s.day}, ${formatTime(s.hour, 0, settings.clock24h)}–${formatTime(endH, 0, settings.clock24h)}`);
    });
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied meeting details to clipboard");
    } catch {
      showToast("Copy failed — select text manually");
    }
  };
  const shareMeeting = async () => {
    if (!meeting) return;
    const lo = Math.min(meeting.startIdx, meeting.endIdx);
    const hi = Math.max(meeting.startIdx, meeting.endIdx);
    const homeStart = grids[0].hours[lo];
    const instant = homeStart.instant.getTime();
    const link = `${location.origin}${location.pathname}?t=${instant}&d=${hi - lo + 1}&z=${activeKeys.join(",")}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast("Share link copied to clipboard");
    } catch {
      showToast("Could not copy link");
    }
  };
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  // Meeting summary labels
  let meetingSummary = null;
  if (meeting) {
    const lo = Math.min(meeting.startIdx, meeting.endIdx);
    const hi = Math.max(meeting.startIdx, meeting.endIdx);
    const homeGrid = grids[0];
    const s = homeGrid.hours[lo];
    const dur = hi - lo + 1;
    meetingSummary = `${s.weekday} ${s.month} ${s.day} · ${formatTime(s.hour, 0, settings.clock24h)} · ${dur}h in ${homeZone.city}`;
  }

  // Date navigation
  const shiftDay = (days) => {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + days);
    setAnchorDate(d);
    setMeeting(null);
  };
  const goToday = () => {
    setAnchorDate(new Date());
    setMeeting(null);
  };
  const anchorLabel = useMemo(() => {
    const p = getParts(anchorDate, homeZone.id);
    const today = getParts(new Date(), homeZone.id);
    const isToday = p.year === today.year && p.month === today.month && p.day === today.day;
    return isToday
      ? `Today · ${p.weekday} ${p.month} ${p.day}`
      : `${p.weekday} ${p.month} ${p.day}, ${p.year}`;
  }, [anchorDate, homeZone, now]);

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark"/>
          <div>
            <div className="brand-name">Meridian</div>
            <div className="brand-sub">Plan across timezones</div>
          </div>
        </div>
        <div className="top-actions">
          <button className="btn ghost" onClick={() => shiftDay(-1)} title="Previous day">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 4l-4 4 4 4"/></svg>
          </button>
          <button className="btn" onClick={goToday}>
            <Icon.Calendar/>
            {anchorLabel}
          </button>
          <button className="btn ghost" onClick={() => shiftDay(1)} title="Next day">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 4l4 4-4 4"/></svg>
          </button>
          <div style={{width: 1, height: 22, background: "var(--line)", margin: "0 6px"}}/>
          <button className="btn primary" onClick={() => setModalOpen(true)}>
            <Icon.Plus/>
            Add timezone
          </button>
        </div>
      </div>

      <div className="meeting-bar">
        {meeting ? (
          <>
            <div className="meeting-pill">
              <Icon.Sparkle/>
              Meeting: {meetingSummary}
            </div>
            <button className="btn" onClick={copyMeeting}><Icon.Copy/>Copy times</button>
            <button className="btn" onClick={shareMeeting}><Icon.Share/>Share link</button>
            <button className="btn ghost" onClick={clearMeeting}><Icon.X/>Clear</button>
          </>
        ) : (
          <div className="meeting-status">
            <span className="chip"><span className="chip-dot"/>Ready</span>
            <span className="meeting-hint">Hover any hour to see it sync across zones · Click &amp; drag to block a meeting</span>
          </div>
        )}
      </div>

      <div className="workspace">
        <div className="rail">
          <div className="rail-header">HOME</div>
          <div className="rail-scroll" ref={railScrollRef}>
            <div className="rail-inner" style={{height: 24 * HOUR_PX}}>
              {grids[0] && grids[0].hours.map((h, i) => (
                <div key={i} className="rail-tick">
                  {formatHour(h.hour, settings.clock24h)}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="columns-wrap">
          <div
            className="columns-scroll"
            ref={scrollRef}
            onScroll={onColumnsScroll}
            onMouseLeave={() => { if (!isDragging) setHoverHour(null); }}
          >
            <div className="columns" style={{gridAutoColumns: `minmax(220px, 1fr)`}}>
              {grids.map((g, i) => (
                <ZoneColumn
                  key={g.zone.key}
                  zoneData={g}
                  isHome={g.zone.key === homeKey}
                  homeOffsetMins={homeOffsetMins}
                  onRemove={removeZone}
                  setHome={setHome}
                  settings={settings}
                  hoverHour={hoverHour}
                  onHoverHour={onHoverHour}
                  onHoverClear={onHoverClear}
                  dragStart={dragStart}
                  dragEnd={dragEnd}
                  onMouseDownHour={onMouseDownHour}
                  onMouseEnterHour={onMouseEnterHour}
                  meeting={meeting}
                  now={now}
                />
              ))}
              <div className="add-col">
                <button className="add-col-btn" onClick={() => setModalOpen(true)}>
                  <Icon.Plus/>
                  Add timezone
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AddZoneModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={addZone}
        activeKeys={activeKeys}
        now={now}
      />

      {toast && (
        <div className="toast">
          <Icon.Check/>
          {toast}
        </div>
      )}

      <TweaksPanel settings={settings} setSettings={setSettings} visible={tweaksVisible}/>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
