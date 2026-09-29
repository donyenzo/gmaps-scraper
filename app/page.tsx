"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ErrorBoundary from "./components/ErrorBoundary";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface Job   { query: string; location: string; maxPages: number; }
interface Place {
  title: string; address: string; category: string; phone: string;
  website: string; rating: number; ratingCount: number;
  latitude: number; longitude: number; placeId: string;
  cid: string; mapsUrl: string; openNow: boolean | null;
  priceLevel: string; query: string; location: string;
}
interface Progress {
  phase:        "idle" | "running" | "done" | "stopped";
  jobIndex:     number;
  totalJobs:    number;
  currentPage:  number;
  maxPages:     number;
  currentQuery: string;
  found:        number;
}
interface Toast { id: number; type: "success" | "error" | "warn" | "info"; msg: string; }

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS  (di luar komponen — tidak re-create setiap render)
// ─────────────────────────────────────────────────────────────────────────────
const stamp = () => new Date().toISOString().slice(11, 19);
const tsFile = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

// FIX: SortIcon sebagai fungsi biasa (bukan komponen di dalam render)
function sortIcon(activeKey: keyof Place, col: keyof Place, dir: 1 | -1): string {
  return activeKey === col ? (dir === 1 ? " ↑" : " ↓") : "";
}

function toCSV(rows: Place[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]) as (keyof Place)[];
  const esc = (v: unknown): string => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r"))
      return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [keys.join(","), ...rows.map(r => keys.map(k => esc(r[k])).join(","))].join("\n");
}

// FIX: revokeObjectURL setelah klik — cegah memory leak
function download(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a   = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function ls(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { /* quota exceeded */ }
}
function lsDel(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SUB-COMPONENTS  (di luar Home — stabil, tidak re-mount setiap render)
// ─────────────────────────────────────────────────────────────────────────────
function Badge({ children, color = "blue" }: { children: React.ReactNode; color?: string }) {
  const cls: Record<string, string> = {
    blue:  "bg-[#1f6feb1a]  text-[#58a6ff]  border-[#1f6feb33]",
    green: "bg-[#238636]/20 text-[#3fb950]  border-[#238636]/30",
    red:   "bg-[#da363633]/20 text-[#f85149] border-[#da3633]/30",
    amber: "bg-[#d29922]/20 text-[#d29922]  border-[#d29922]/30",
  };
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-xs font-medium ${cls[color] ?? cls.blue}`}>
      {children}
    </span>
  );
}

// ── Toast notification ───────────────────────────────────────────────────────
function ToastList({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  const cls: Record<Toast["type"], string> = {
    success: "border-[#238636]/50 text-[#3fb950]",
    error:   "border-[#f85149]/50 text-[#f85149]",
    warn:    "border-[#d29922]/50 text-[#d29922]",
    info:    "border-[#58a6ff]/50 text-[#58a6ff]",
  };
  const icon: Record<Toast["type"], string> = {
    success: "✅", error: "❌", warn: "⚠️", info: "ℹ️",
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-2 bg-[#161b22] border rounded-lg px-3 py-2.5
                      text-xs shadow-lg shadow-black/40 animate-in slide-in-from-right-2 ${cls[t.type]}`}
        >
          <span className="flex-shrink-0">{icon[t.type]}</span>
          <span className="flex-1 text-[#c9d1d9]">{t.msg}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="flex-shrink-0 text-[#484f58] hover:text-[#8b949e] ml-1"
            aria-label="Tutup notifikasi"
          >✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ progress }: { progress: Progress }) {
  if (progress.phase === "idle") return null;

  const jobPct  = progress.totalJobs   > 0
    ? Math.round((progress.jobIndex / progress.totalJobs) * 100) : 0;
  const pagePct = progress.maxPages    > 0
    ? Math.round((progress.currentPage / progress.maxPages) * 100) : 0;
  const phaseLbl: Record<Progress["phase"], string> = {
    idle: "", running: "Sedang berjalan...", done: "Selesai", stopped: "Dihentikan",
  };

  return (
    <div className="card p-3 space-y-2">
      {/* Job progress */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#8b949e]">
          Job <span className="text-[#e6edf3] font-medium">{progress.jobIndex}</span>
          <span className="text-[#484f58]"> / {progress.totalJobs}</span>
          {progress.currentQuery &&
            <span className="text-[#8b949e] ml-1 truncate max-w-[160px] inline-block align-bottom">
              — &ldquo;{progress.currentQuery}&rdquo;
            </span>}
        </span>
        <span className={`font-medium ${
          progress.phase === "done"    ? "text-[#3fb950]" :
          progress.phase === "stopped" ? "text-[#d29922]" : "text-[#58a6ff]"}`}>
          {phaseLbl[progress.phase]}
        </span>
      </div>
      {/* Overall bar */}
      <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${jobPct}%`,
            background: progress.phase === "done"
              ? "#3fb950" : progress.phase === "stopped"
              ? "#d29922" : "#58a6ff",
          }}
        />
      </div>
      {/* Page progress (hanya saat running) */}
      {progress.phase === "running" && progress.maxPages > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[#484f58] text-xs shrink-0">
            Halaman {progress.currentPage}/{progress.maxPages}
          </span>
          <div className="flex-1 h-1 bg-[#21262d] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#1f6feb] rounded-full transition-all duration-300"
              style={{ width: `${pagePct}%` }}
            />
          </div>
          <span className="text-[#3fb950] text-xs shrink-0 font-medium">
            {progress.found} tempat
          </span>
        </div>
      )}
      {progress.phase !== "running" && (
        <div className="text-right text-xs text-[#3fb950] font-medium">
          {progress.found} tempat unik ditemukan
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
function ScraperApp() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [authToken, setAuthToken]   = useState("");
  const [authInput, setAuthInput]   = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [apiKeys, setApiKeys]       = useState<string[]>([]);
  const [keyInput, setKeyInput]     = useState("");
  const [jobs, setJobs]             = useState<Job[]>([]);
  const [qInput, setQInput]         = useState("");
  const [locInput, setLocInput]     = useState("Jakarta, Indonesia");
  const [pagesInput, setPagesInput] = useState(3);
  const [gl, setGl]                 = useState("id");
  const [hl, setHl]                 = useState("id");
  const [num, setNum]               = useState(20);
  const [running, setRunning]       = useState(false);
  const [logs, setLogs]             = useState<string[]>([]);
  const [places, setPlaces]         = useState<Place[]>([]);
  const [progress, setProgress]     = useState<Progress>({
    phase: "idle", jobIndex: 0, totalJobs: 0,
    currentPage: 0, maxPages: 0, currentQuery: "", found: 0,
  });
  const [toasts, setToasts]         = useState<Toast[]>([]);
  const [search, setSearch]         = useState("");
  const [sortKey, setSortKey]       = useState<keyof Place>("title");
  const [sortDir, setSortDir]       = useState<1 | -1>(1);
  const [tablePage, setTablePage]   = useState(1);
  const [sessionBanner, setSessionBanner] = useState<number>(0);
  const [viewMode, setViewMode]     = useState<"table" | "map">("table");
  const [notifPerm, setNotifPerm]   = useState<string>("default");
  const logRef     = useRef<HTMLDivElement>(null);
  const abortRef   = useRef<AbortController | null>(null);
  const mapRef     = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstRef = useRef<any>(null);
  const perPage    = 20;

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const addToast = useCallback((type: Toast["type"], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p.slice(-4), { id, type, msg }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);
  const dismissToast = useCallback((id: number) =>
    setToasts(p => p.filter(t => t.id !== id)), []);

  // ── Log helpers ────────────────────────────────────────────────────────────
  const addLog = useCallback((msg: string) =>
    setLogs(p => [...p.slice(-200), `[${stamp()}] ${msg}`]), []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // ── Load localStorage on mount ─────────────────────────────────────────────
  useEffect(() => {
    const token = ls("scraper_auth_token");
    const keys  = JSON.parse(ls("scraper_api_keys")  || "[]");
    const savedJobs = JSON.parse(ls("scraper_jobs")  || "[]");
    const prevResults: Place[] = JSON.parse(ls("scraper_results") || "[]");

    if (token)                               { setAuthToken(token); setTokenSaved(true); }
    if (Array.isArray(keys)  && keys.length)  setApiKeys(keys);
    if (Array.isArray(savedJobs) && savedJobs.length) setJobs(savedJobs);
    if (prevResults.length)                  setSessionBanner(prevResults.length);
  }, []);

  // ── Persist jobs queue ─────────────────────────────────────────────────────
  useEffect(() => {
    lsSet("scraper_jobs", JSON.stringify(jobs));
  }, [jobs]);

  // ── Persist results (max 1000 rows, ~500 KB) ───────────────────────────────
  useEffect(() => {
    if (places.length === 0) return;
    lsSet("scraper_results", JSON.stringify(places.slice(-1000)));
  }, [places]);

  // ── Auth token ──────────────────────────────────────────────────────────────
  const saveToken = () => {
    const t = authInput.trim();
    if (!t) { addToast("warn", "Token tidak boleh kosong"); return; }
    lsSet("scraper_auth_token", t);
    setAuthToken(t);
    setAuthInput("");
    setTokenSaved(true);
    addToast("success", "Auth token disimpan");
  };
  const clearToken = () => {
    lsDel("scraper_auth_token");
    setAuthToken("");
    setTokenSaved(false);
    addToast("info", "Auth token dihapus");
  };

  // ── API Keys ────────────────────────────────────────────────────────────────
  const addKeys = () => {
    const parsed = keyInput.split(/[\n,]/).map(k => k.trim()).filter(Boolean);
    if (!parsed.length) { addToast("warn", "Tidak ada key yang valid"); return; }
    const next = [...new Set([...apiKeys, ...parsed])];
    setApiKeys(next);
    setKeyInput("");
    lsSet("scraper_api_keys", JSON.stringify(next));
    addToast("success", `${parsed.length} key ditambahkan (total: ${next.length})`);
  };
  const removeKey = (k: string) => {
    const next = apiKeys.filter(x => x !== k);
    setApiKeys(next);
    lsSet("scraper_api_keys", JSON.stringify(next));
  };

  // ── Jobs queue ──────────────────────────────────────────────────────────────
  const addJob = () => {
    const q = qInput.trim();
    const l = locInput.trim();
    if (!q) { addToast("error", "Query pencarian tidak boleh kosong"); return; }
    if (!l) { addToast("error", "Lokasi tidak boleh kosong"); return; }
    const isDup = jobs.some(j => j.query === q && j.location === l);
    if (isDup) { addToast("warn", `Job "${q}" di ${l} sudah ada`); return; }
    setJobs(p => [...p, { query: q, location: l, maxPages: pagesInput }]);
    setQInput("");
    addToast("success", `Job "${q}" ditambahkan ke antrian`);
  };
  const removeJob = (i: number) => setJobs(p => p.filter((_, j) => j !== i));

  // ── Session restore ─────────────────────────────────────────────────────────
  const restoreSession = () => {
    try {
      const prev: Place[] = JSON.parse(ls("scraper_results") || "[]");
      if (prev.length) {
        setPlaces(prev);
        setSessionBanner(0);
        addToast("success", `${prev.length} hasil sesi sebelumnya dimuat`);
      }
    } catch { addToast("error", "Gagal memuat sesi sebelumnya"); }
  };
  const dismissBanner = () => {
    setSessionBanner(0);
    lsDel("scraper_results");
  };

  // ── Scraping ────────────────────────────────────────────────────────────────
  const stopScraping = () => {
    abortRef.current?.abort();
    setRunning(false);
    setProgress(p => ({ ...p, phase: "stopped" }));
    addToast("warn", "Scraping dihentikan");
  };

  const startScraping = async () => {
    // Validasi dengan feedback
    if (!apiKeys.length) {
      addToast("error", "Tambahkan minimal 1 API key Serper.dev terlebih dahulu");
      return;
    }
    if (!jobs.length) {
      addToast("error", "Tambahkan minimal 1 job ke antrian terlebih dahulu");
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setRunning(true);
    setPlaces([]);
    setLogs([]);
    setProgress({ phase: "running", jobIndex: 0, totalJobs: jobs.length,
                  currentPage: 0, maxPages: 0, currentQuery: "", found: 0 });
    addLog(`🚀 Memulai ${jobs.length} job dengan ${apiKeys.length} key...`);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    try {
      const resp = await fetch("/api/scrape", {
        method: "POST", headers, signal: ctrl.signal,
        body: JSON.stringify({ jobs, apiKeys, gl, hl, num }),
      });

      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        const errMsg = data.error ?? `HTTP ${resp.status}`;
        if      (resp.status === 401) addToast("error", `401 Unauthorized — ${errMsg}`);
        else if (resp.status === 429) addToast("error", `429 Rate limited — ${errMsg}`);
        else if (resp.status === 422) addToast("error", `Validasi gagal — ${errMsg}`);
        else                          addToast("error", errMsg);
        addLog(`❌ ${errMsg}`);
        setRunning(false);
        setProgress(p => ({ ...p, phase: "stopped" }));
        return;
      }

      const reader  = resp.body.getReader();
      const dec     = new TextDecoder();
      let   buf     = "";
      let   jobsDone = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            switch (ev.type) {
              case "init":
                addLog(`🔑 ${ev.keyCount} key aktif — ${ev.totalJobs} job`);
                setProgress(p => ({ ...p, totalJobs: ev.totalJobs }));
                break;
              case "job_start":
                addLog(`▶ "${ev.query}" @ ${ev.location}`);
                setProgress(p => ({
                  ...p, currentQuery: ev.query,
                  jobIndex: jobsDone, maxPages: 0, currentPage: 0,
                }));
                break;
              case "page":
                addLog(`  📄 halaman ${ev.page}...`);
                setProgress(p => ({ ...p, currentPage: ev.page }));
                break;
              case "data":
                setPlaces(p => [...p, ...ev.places]);
                addLog(`  ✔  ${ev.count} tempat`);
                setProgress(p => ({ ...p, found: p.found + ev.count }));
                break;
              case "no_more":
                addLog(`  ⏹ halaman ${ev.page} kosong, lanjut`);
                break;
              case "job_done":
                jobsDone++;
                addLog(`✅ "${ev.query}" — ${ev.subtotal} tempat`);
                setProgress(p => ({
                  ...p, jobIndex: jobsDone,
                  maxPages: pagesInput,
                }));
                break;
              case "warn":
                addLog(`⚠  ${ev.msg}`);
                break;
              case "done":
                addLog(`🎉 SELESAI! ${ev.total} tempat unik`);
                addToast("success", `Selesai! ${ev.total} tempat unik ditemukan`);
                setProgress(p => ({ ...p, phase: "done", jobIndex: p.totalJobs }));
                sendBrowserNotif(ev.total);   // notif browser jika izin sudah diberikan
                break;
              case "error":
              case "fatal":
                addLog(`❌ ${ev.msg}`);
                addToast("error", ev.msg);
                break;
            }
          } catch { /* baris rusak, skip */ }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        // sudah di-handle di stopScraping()
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        addLog(`❌ ${msg}`);
        addToast("error", msg);
      }
    }
    setRunning(false);
    setProgress(p => p.phase === "running" ? { ...p, phase: "done" } : p);
  };

  // ── Table logic (memoized) ─────────────────────────────────────────────────
  const filtered = useMemo(() =>
    !search ? places : places.filter(p =>
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.address.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase())
    ), [places, search]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      return typeof av === "number" && typeof bv === "number"
        ? sortDir * (av - bv)
        : sortDir * String(av).localeCompare(String(bv));
    }), [filtered, sortKey, sortDir]);

  const totalTablePages = Math.max(1, Math.ceil(sorted.length / perPage));
  const paged = sorted.slice((tablePage - 1) * perPage, tablePage * perPage);

  const doSort = (key: keyof Place) => {
    if (sortKey === key) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortKey(key); setSortDir(1); }
    setTablePage(1);
  };

  const exportCSV  = () => download(toCSV(places),  `gmaps_${tsFile()}.csv`,  "text/csv;charset=utf-8");
  const exportJSON = () => download(JSON.stringify(places, null, 2), `gmaps_${tsFile()}.json`, "application/json");
  // ── Browser notifications ──────────────────────────────────────────────────
  const requestNotifPermission = async () => {
    if (!("Notification" in window)) { setNotifPerm("unsupported"); return; }
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm === "granted") addToast("success", "Notifikasi browser diaktifkan");
    else addToast("warn", "Izin notifikasi ditolak");
  };

  const sendBrowserNotif = (total: number) => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    new Notification("🎉 Scraping Selesai!", {
      body: `${total} tempat unik ditemukan`,
      icon: "/favicon.ico",
    });
  };

  // ── Google Sheets export ───────────────────────────────────────────────────
  const exportToSheets = async () => {
    if (!places.length) return;
    const csv = toCSV(places);
    try {
      await navigator.clipboard.writeText(csv);
      addToast("success", "CSV disalin! Buka sheets.new → File → Import → Upload → Paste");
    } catch {
      addToast("info", "Buka sheets.new → File → Import, lalu upload file CSV yang sudah didownload");
    }
  };

  // ── Leaflet map loader ─────────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== "map") return;
    const container = mapRef.current;
    if (!container) return;

    const validPlaces = places.filter(p => p.latitude && p.longitude);
    if (!validPlaces.length) return;

    const loadLeaflet = async () => {
      // Cek apakah Leaflet sudah dimuat
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (!w.L) {
        await new Promise<void>((res, rej) => {
          if (!document.getElementById("leaflet-css")) {
            const link = document.createElement("link");
            link.id   = "leaflet-css";
            link.rel  = "stylesheet";
            link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
            document.head.appendChild(link);
          }
          const s  = document.createElement("script");
          s.src    = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
          s.onload = () => res();
          s.onerror = () => rej(new Error("Gagal memuat Leaflet"));
          document.head.appendChild(s);
        });
      }

      const L = w.L;
      // Hapus instance lama
      if (mapInstRef.current) { mapInstRef.current.remove(); mapInstRef.current = null; }

      const map = L.map(container).setView(
        [validPlaces[0].latitude, validPlaces[0].longitude], 12
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const bounds: [number, number][] = [];
      for (const p of validPlaces) {
        bounds.push([p.latitude, p.longitude]);
        const popup = [
          `<b>${p.title || "?"}</b>`,
          p.category ? `<span style="color:#888">${p.category}</span>` : "",
          p.address  ? `📍 ${p.address}` : "",
          p.phone    ? `📞 ${p.phone}` : "",
          p.rating   ? `⭐ ${p.rating} (${p.ratingCount?.toLocaleString()})` : "",
          p.mapsUrl  ? `<a href="${p.mapsUrl}" target="_blank">Buka di Maps ↗</a>` : "",
        ].filter(Boolean).join("<br>");
        L.marker([p.latitude, p.longitude]).addTo(map).bindPopup(popup);
      }
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
      mapInstRef.current = map;
    };

    loadLeaflet().catch(e => addToast("error", `Map error: ${e.message}`));

    return () => {
      if (mapInstRef.current) { mapInstRef.current.remove(); mapInstRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, places.length]);

  // ── TABLE COLUMNS CONFIG ────────────────────────────────────────────────────
  const COLS: [keyof Place, string][] = [
    ["title", "Nama"], ["category", "Kategori"], ["address", "Alamat"],
    ["phone", "Telepon"], ["rating", "Rating"], ["ratingCount", "Reviews"],
    ["website", "Website"],
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      <ToastList toasts={toasts} onDismiss={dismissToast} />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-[#30363d] px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">🗺️</span>
          <span className="font-semibold text-[#e6edf3]">Google Maps Scraper</span>
          <Badge color="green">Serper.dev</Badge>
          {running && <Badge color="blue">● Live</Badge>}
        </div>
        <div className="flex items-center gap-3">
          {places.length > 0 && (
            <Badge color="amber">{places.length} hasil</Badge>
          )}
          <a href="https://serper.dev" target="_blank" rel="noreferrer"
             className="text-xs text-[#58a6ff] hover:underline">
            Get API Keys →
          </a>
        </div>
      </header>

      {/* ── Session restore banner ──────────────────────────────────────── */}
      {sessionBanner > 0 && places.length === 0 && (
        <div className="bg-[#1f6feb]/10 border-b border-[#1f6feb]/20 px-4 sm:px-6 py-2.5
                        flex flex-wrap items-center gap-3 text-xs">
          <span className="text-[#58a6ff]">
            💾 Ada <strong>{sessionBanner}</strong> hasil dari sesi sebelumnya
          </span>
          <button onClick={restoreSession}
                  className="btn-blue px-3 py-1 text-xs">Muat</button>
          <button onClick={dismissBanner}
                  className="text-[#484f58] hover:text-[#8b949e]">Abaikan</button>
        </div>
      )}

      {/* ── Main layout: mobile=column, desktop=row ─────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 p-4 max-w-[1600px] mx-auto">

        {/* ════ LEFT PANEL ════════════════════════════════════════════════ */}
        <aside className="w-full lg:w-80 lg:flex-shrink-0 flex flex-col gap-4">

          {/* Auth Token */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#e6edf3]">🔐 Auth Token</h2>
              {tokenSaved ? <Badge color="green">✓ Aktif</Badge>
                          : <Badge color="red">⚠ Belum diset</Badge>}
            </div>
            {tokenSaved ? (
              <div className="flex items-center justify-between bg-[#0d1117] rounded px-3 py-2 text-xs">
                <span className="font-mono text-[#8b949e]">••••••••••••••••</span>
                <button onClick={clearToken} className="text-[#f85149] hover:underline ml-2 text-xs">
                  Hapus
                </button>
              </div>
            ) : (
              <>
                <input type="password" className="input mb-2"
                  placeholder="Paste SCRAPER_AUTH_TOKEN..."
                  value={authInput}
                  onChange={e => setAuthInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveToken()} />
                <button onClick={saveToken} className="btn-secondary w-full">
                  💾 Simpan Token
                </button>
                <p className="text-[#484f58] text-xs mt-2 leading-relaxed">
                  Set <code className="text-[#8b949e]">SCRAPER_AUTH_TOKEN</code> di Vercel
                  env vars, lalu paste di sini.
                </p>
              </>
            )}
          </div>

          {/* API Keys */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#e6edf3]">🔑 API Keys</h2>
              {apiKeys.length > 0 && <Badge color="green">{apiKeys.length} aktif</Badge>}
            </div>
            <textarea className="input h-20 resize-none font-mono text-xs"
              placeholder={"key1\nkey2\nkey3"}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)} />
            <button onClick={addKeys} className="btn-secondary w-full mt-2">
              + Tambah Keys
            </button>
            {apiKeys.length > 0 && (
              <div className="mt-3 space-y-1 max-h-28 overflow-y-auto">
                {apiKeys.map(k => (
                  <div key={k}
                       className="flex items-center justify-between bg-[#0d1117] rounded px-2 py-1">
                    <span className="font-mono text-xs text-[#8b949e] truncate">
                      {k.slice(0, 6)}...{k.slice(-6)}
                    </span>
                    <button onClick={() => removeKey(k)}
                            className="text-[#f85149] text-xs ml-2 flex-shrink-0"
                            aria-label={`Hapus key ...${k.slice(-6)}`}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Job Queue */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-[#e6edf3] mb-3">📋 Job Queue</h2>
            <div className="space-y-2">
              <div>
                <label htmlFor="q-input" className="label">Query Pencarian</label>
                <input id="q-input" className="input"
                  placeholder="restoran padang, hotel bintang 4..."
                  value={qInput}
                  onChange={e => setQInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addJob()} />
              </div>
              <div>
                <label htmlFor="loc-input" className="label">Lokasi</label>
                <input id="loc-input" className="input"
                  placeholder="Jakarta, Indonesia"
                  value={locInput}
                  onChange={e => setLocInput(e.target.value)} />
              </div>
              <div>
                <label className="label">
                  Max Halaman: <span className="text-[#e6edf3]">{pagesInput}</span>
                  <span className="text-[#484f58] ml-1">(~{pagesInput * num} hasil)</span>
                </label>
                <input type="range" min={1} max={10} value={pagesInput}
                  onChange={e => setPagesInput(+e.target.value)}
                  className="w-full accent-[#58a6ff]" />
                <div className="flex justify-between text-xs text-[#484f58]">
                  <span>1</span><span>10</span>
                </div>
              </div>
              <button onClick={addJob} className="btn-secondary w-full">
                + Tambah ke Antrian
              </button>
            </div>

            {jobs.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#8b949e]">{jobs.length} job</span>
                  <button onClick={() => setJobs([])}
                          className="text-xs text-[#f85149] hover:underline">
                    Hapus semua
                  </button>
                </div>
                {jobs.map((j, i) => (
                  <div key={i}
                       className="flex items-center justify-between bg-[#0d1117] rounded px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="text-[#e6edf3] truncate font-medium">{j.query}</div>
                      <div className="text-[#8b949e] truncate">{j.location} · {j.maxPages}p</div>
                    </div>
                    <button onClick={() => removeJob(i)}
                            className="text-[#f85149] text-xs ml-2 flex-shrink-0"
                            aria-label={`Hapus job ${j.query}`}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-[#e6edf3] mb-3">⚙️ Pengaturan</h2>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label">gl</label>
                <select value={gl} onChange={e => setGl(e.target.value)} className="input">
                  <option value="id">id</option><option value="us">us</option>
                  <option value="sg">sg</option><option value="my">my</option>
                  <option value="au">au</option>
                </select>
              </div>
              <div>
                <label className="label">hl</label>
                <select value={hl} onChange={e => setHl(e.target.value)} className="input">
                  <option value="id">id</option><option value="en">en</option>
                </select>
              </div>
              <div>
                <label className="label">num</label>
                <select value={num} onChange={e => setNum(+e.target.value)} className="input">
                  <option value={10}>10</option><option value={20}>20</option>
                </select>
              </div>
            </div>
          </div>

          {/* Start / Stop */}
          {running ? (
            <button onClick={stopScraping}
                    className="w-full py-3 text-base font-semibold rounded-md text-white
                               bg-[#da3633] hover:bg-[#f85149] transition-colors">
              ⏹ Stop Scraping
            </button>
          ) : (
            <>
              <button onClick={startScraping}
                      disabled={!apiKeys.length || !jobs.length}
                      className="btn-primary w-full py-3 text-base">
                🚀 Mulai Scraping
              </button>
              {/* Validation hint — visible reason why button is disabled */}
              {(!apiKeys.length || !jobs.length) && (
                <p className="text-[#484f58] text-xs text-center -mt-1">
                  {!apiKeys.length && !jobs.length
                    ? "Tambahkan API key dan job terlebih dahulu"
                    : !apiKeys.length ? "⚠ Belum ada API key"
                                      : "⚠ Belum ada job di antrian"}
                </p>
              )}
            </>
          )}
        </aside>

        {/* ════ RIGHT PANEL ═══════════════════════════════════════════════ */}
        <main className="flex-1 min-w-0 flex flex-col gap-4">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Tempat",   value: places.length,   color: "text-[#58a6ff]" },
              { label: "Setelah Filter", value: filtered.length, color: "text-[#3fb950]" },
              { label: "Jobs",           value: jobs.length,     color: "text-[#d29922]" },
            ].map(s => (
              <div key={s.label} className="card p-3 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-[#8b949e] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <ProgressBar progress={progress} />

          {/* Log */}
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-[#e6edf3]">📡 Log Real-time</h2>
              <button onClick={() => setLogs([])}
                      className="text-xs text-[#484f58] hover:text-[#8b949e]">
                Clear
              </button>
            </div>
            <div ref={logRef}
                 className="bg-[#0d1117] rounded font-mono text-xs text-[#8b949e]
                            p-3 h-32 overflow-y-auto">
              {logs.length === 0
                ? <span className="text-[#484f58]">Log akan muncul saat scraping dimulai...</span>
                : logs.map((l, i) => (
                    <div key={i} className={
                      l.includes("✅") || l.includes("🎉") ? "text-[#3fb950]" :
                      l.includes("❌")                     ? "text-[#f85149]" :
                      l.includes("⚠")                      ? "text-[#d29922]" :
                      l.includes("✔")                      ? "text-[#c9d1d9]" : ""
                    }>{l}</div>
                  ))}
            </div>
          </div>

          {/* Table */}
          <div className="card flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[#30363d]">
              {/* Tab selector */}
              <div className="flex rounded-md overflow-hidden border border-[#30363d] text-xs">
                {(["table","map"] as const).map(mode => (
                  <button key={mode}
                          onClick={() => setViewMode(mode)}
                          className={`px-3 py-1.5 transition-colors ${
                            viewMode === mode
                              ? "bg-[#1f6feb] text-white"
                              : "bg-[#21262d] text-[#8b949e] hover:text-[#c9d1d9]"
                          }`}>
                    {mode === "table" ? "📊 Tabel" : "🗺 Peta"}
                  </button>
                ))}
              </div>
              {/* Filter (table only) */}
              {viewMode === "table" && (
                <input className="input max-w-xs"
                  placeholder="🔍 Filter nama / alamat / kategori..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setTablePage(1); }} />
              )}
              <div className="ml-auto flex gap-2 flex-wrap">
                <button onClick={exportCSV}     disabled={!places.length} className="btn-secondary">⬇ CSV</button>
                <button onClick={exportJSON}    disabled={!places.length} className="btn-secondary">⬇ JSON</button>
                <button onClick={exportToSheets} disabled={!places.length} className="btn-secondary"
                        title="Salin CSV ke clipboard untuk import ke Google Sheets">
                  📊 Sheets
                </button>
                {/* Notifikasi */}
                <button onClick={requestNotifPermission}
                        title={notifPerm === "granted" ? "Notifikasi aktif" : "Aktifkan notifikasi browser"}
                        className={`btn-secondary ${notifPerm === "granted" ? "text-[#3fb950]" : ""}`}>
                  {notifPerm === "granted" ? "🔔" : "🔕"}
                </button>
                {places.length > 0 && (
                  <button onClick={() => { setPlaces([]); lsDel("scraper_results"); }}
                          className="btn-secondary text-[#f85149] border-[#f85149]/30">
                    🗑 Reset
                  </button>
                )}
              </div>
            </div>

            {/* FIX: overflow-x-auto untuk mobile + min-w agar tidak squish */}
            <div className={`overflow-x-auto flex-1 ${viewMode === "map" ? "hidden" : ""}`}>
              <table className="w-full text-xs border-collapse min-w-[720px]">
                <thead className="sticky top-0 bg-[#161b22] z-10">
                  <tr className="border-b border-[#30363d]">
                    <th className="text-left px-3 py-2 text-[#8b949e] font-medium w-8">#</th>
                    {COLS.map(([k, label]) => (
                      <th key={k}
                          onClick={() => doSort(k)}
                          className="text-left px-3 py-2 text-[#8b949e] font-medium cursor-pointer
                                     hover:text-[#c9d1d9] whitespace-nowrap select-none">
                        {label}{sortIcon(sortKey, k, sortDir)}
                      </th>
                    ))}
                    <th className="text-left px-3 py-2 text-[#8b949e] font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={COLS.length + 2} className="text-center py-16 text-[#484f58]">
                        {places.length === 0
                          ? "Belum ada data. Tambahkan jobs dan mulai scraping."
                          : "Tidak ada hasil cocok dengan filter."}
                      </td>
                    </tr>
                  ) : paged.map((p, i) => (
                    <tr key={p.placeId || p.cid || i}
                        className="border-b border-[#21262d] hover:bg-[#1c2128] transition-colors">
                      <td className="px-3 py-2 text-[#484f58]">
                        {(tablePage - 1) * perPage + i + 1}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#e6edf3] max-w-[160px]">
                        <div className="truncate" title={p.title}>{p.title || "-"}</div>
                      </td>
                      <td className="px-3 py-2 text-[#8b949e] whitespace-nowrap">
                        {p.category || "-"}
                      </td>
                      <td className="px-3 py-2 text-[#8b949e] max-w-[180px]">
                        <div className="truncate" title={p.address}>{p.address || "-"}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.phone
                          ? <a href={`tel:${p.phone}`} className="text-[#58a6ff] hover:underline">{p.phone}</a>
                          : "-"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.rating
                          ? <span className="text-[#d29922]">{p.rating.toFixed(1)} ★</span>
                          : "-"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#8b949e]">
                        {p.ratingCount ? p.ratingCount.toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2 max-w-[130px]">
                        {p.website
                          ? <a href={p.website} target="_blank" rel="noreferrer"
                               className="text-[#58a6ff] hover:underline truncate block"
                               title={p.website}>
                              {p.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                            </a>
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {p.mapsUrl
                          ? <a href={p.mapsUrl} target="_blank" rel="noreferrer"
                               className="text-[#58a6ff] hover:underline whitespace-nowrap">
                              Maps ↗
                            </a>
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Map view */}
            {viewMode === "map" && (
              <div className="flex-1 relative" style={{ minHeight: "400px" }}>
                {places.filter(p => p.latitude && p.longitude).length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[#484f58] text-sm">
                    Tidak ada koordinat untuk divisualisasikan.
                    Mulai scraping untuk mendapatkan data lokasi.
                  </div>
                ) : (
                  <>
                    <div ref={mapRef} className="w-full h-full" style={{ minHeight: "400px" }} />
                    <div className="absolute bottom-2 left-2 z-[1000] bg-[#161b22]/90
                                    border border-[#30363d] rounded px-2 py-1 text-xs text-[#8b949e]">
                      {places.filter(p => p.latitude && p.longitude).length} marker
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Pagination */}
            {viewMode === "table" && totalTablePages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-[#30363d]">
                <span className="text-xs text-[#8b949e]">
                  {filtered.length} hasil · halaman {tablePage}/{totalTablePages}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setTablePage(p => Math.max(1, p - 1))}
                          disabled={tablePage === 1}
                          className="btn-secondary px-2 py-1 disabled:opacity-30">←</button>
                  {Array.from({ length: Math.min(5, totalTablePages) }, (_, i) => {
                    const pg = Math.max(1, Math.min(totalTablePages - 4, tablePage - 2)) + i;
                    return (
                      <button key={pg} onClick={() => setTablePage(pg)}
                              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                                pg === tablePage
                                  ? "bg-[#1f6feb] text-white border-[#1f6feb]"
                                  : "bg-[#21262d] text-[#c9d1d9] border-[#30363d] hover:bg-[#30363d]"
                              }`}>
                        {pg}
                      </button>
                    );
                  })}
                  <button onClick={() => setTablePage(p => Math.min(totalTablePages, p + 1))}
                          disabled={tablePage === totalTablePages}
                          className="btn-secondary px-2 py-1 disabled:opacity-30">→</button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Wrap dengan ErrorBoundary ─────────────────────────────────────────────────
export default function Home() {
  return (
    <ErrorBoundary>
      <ScraperApp />
    </ErrorBoundary>
  );
}
