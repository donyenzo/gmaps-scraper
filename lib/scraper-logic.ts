/**
 * lib/scraper-logic.ts
 * Pure logic (no HTTP, no Next.js) — dapat di-import oleh route dan test.
 */

export interface Job {
  query: string;
  location: string;
  maxPages: number;
}

export interface ScrapeInput {
  jobs: Job[];
  apiKeys: string[];
  gl: string;
  hl: string;
  num: number;
}

export interface Place {
  title: string;
  address: string;
  category: string;
  phone: string;
  website: string;
  rating: number;
  ratingCount: number;
  latitude: number;
  longitude: number;
  placeId: string;
  cid: string;
  mapsUrl: string;
  openNow: boolean | null;
  priceLevel: string;
  thumbnailUrl: string;
  openingHours: string[];
  query: string;
  location: string;
}

export type ValidationResult =
  | { ok: true; data: ScrapeInput }
  | { ok: false; error: string };

export interface FetchResult {
  places: unknown[];
  status: number;
  errMsg: string;
  fromCache: boolean;
}

export const LIMITS = {
  MAX_JOBS:     20,
  MAX_PAGES:    10,
  MAX_QUERY:   200,
  MAX_LOC:     200,
  MAX_KEYS:     50,
  MAX_KEY_LEN: 128,
} as const;

export class Semaphore {
  private n: number;
  private readonly q: Array<() => void> = [];

  constructor(n: number) {
    if (n < 1) throw new RangeError("Semaphore: n harus >= 1");
    this.n = n;
  }

  acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const attempt = () => {
        if (this.n > 0) {
          this.n--;
          resolve(() => { this.n++; this.q.shift()?.(); });
        } else {
          this.q.push(attempt);
        }
      };
      attempt();
    });
  }

  get available() { return this.n; }
}

export class KeyRotator {
  private readonly keys: string[];
  private idx = 0;
  private readonly failed = new Set<string>();

  constructor(keys: string[]) {
    if (!keys.length) throw new Error("KeyRotator: minimal 1 key");
    this.keys = [...keys];
  }

  next(): string {
    const active = this.keys.filter(k => !this.failed.has(k));
    if (!active.length) throw new Error("Semua API key gagal.");
    const key = active[this.idx % active.length];
    this.idx = (this.idx + 1) % 1_000_000;
    return key;
  }

  fail(key: string) { this.failed.add(key); }

  get activeCount() { return this.keys.filter(k => !this.failed.has(k)).length; }

  get totalCount() { return this.keys.length; }
}

interface CacheEntry { data: unknown[]; exp: number; }
const _cache = new Map<string, CacheEntry>();
const CACHE_MAX = 200;

export const CACHE_TTL_MS =
  Number(process.env.CACHE_TTL_HOURS ?? 24) * 3_600_000;

export function cacheKey(
  q: string, loc: string, start: number, gl: string, hl: string
): string {
  return [q, loc, String(start), gl, hl]
    .map(s => s.trim().toLowerCase())
    .join("|");
}

export function cacheGet(key: string): unknown[] | null {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(key); return null; }
  return e.data;
}

export function cacheSet(key: string, data: unknown[]): void {
  if (_cache.size >= CACHE_MAX) {
    let earliest = Infinity, evictKey = "";
    for (const [k, v] of _cache) {
      if (v.exp < earliest) { earliest = v.exp; evictKey = k; }
    }
    if (evictKey) _cache.delete(evictKey);
  }
  _cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS });
}

export function cacheClear() { _cache.clear(); }
export function cacheSize()  { return _cache.size; }

export function validate(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object")
    return { ok: false, error: "Request body tidak valid" };

  const b = raw as Record<string, unknown>;

  if (!Array.isArray(b.jobs) || b.jobs.length === 0)
    return { ok: false, error: "jobs harus berupa array yang tidak kosong" };
  if (b.jobs.length > LIMITS.MAX_JOBS)
    return { ok: false, error: `Maksimal ${LIMITS.MAX_JOBS} job per request` };

  const jobs: Job[] = [];
  for (const [i, rawJob] of (b.jobs as unknown[]).entries()) {
    if (!rawJob || typeof rawJob !== "object")
      return { ok: false, error: `Job[${i}] bukan object` };
    const j = rawJob as Record<string, unknown>;

    const query = String(j.query ?? "").trim();
    if (!query)                           return { ok: false, error: `Job[${i}]: query wajib diisi` };
    if (query.length > LIMITS.MAX_QUERY) return { ok: false, error: `Job[${i}]: query maks ${LIMITS.MAX_QUERY} karakter` };

    const location = String(j.location ?? "").trim();
    if (!location)                          return { ok: false, error: `Job[${i}]: location wajib diisi` };
    if (location.length > LIMITS.MAX_LOC)  return { ok: false, error: `Job[${i}]: location maks ${LIMITS.MAX_LOC} karakter` };

    const maxPages = Number(j.maxPages);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > LIMITS.MAX_PAGES)
      return { ok: false, error: `Job[${i}]: maxPages harus bilangan bulat 1–${LIMITS.MAX_PAGES}` };

    jobs.push({ query, location, maxPages });
  }

  const rawKeys = Array.isArray(b.apiKeys) ? (b.apiKeys as unknown[]) : [];
  if (rawKeys.length > LIMITS.MAX_KEYS)
    return { ok: false, error: `Maksimal ${LIMITS.MAX_KEYS} API key` };
  const apiKeys = rawKeys
    .map(k => String(k).trim())
    .filter(k => k.length > 0 && k.length <= LIMITS.MAX_KEY_LEN);

  const gl = String(b.gl ?? "id").toLowerCase().trim();
  const hl = String(b.hl ?? "id").toLowerCase().trim();
  if (!/^[a-z]{2}$/.test(gl)) return { ok: false, error: `gl tidak valid: "${gl}"` };
  if (!/^[a-z]{2}$/.test(hl)) return { ok: false, error: `hl tidak valid: "${hl}"` };

  const num = Number(b.num ?? 20);
  if (![10, 20].includes(num)) return { ok: false, error: "num harus 10 atau 20" };

  return { ok: true, data: { jobs, apiKeys, gl, hl, num } };
}

export function parsePlaceItem(
  item: any,
  query: string,
  location: string
): Place {
  const pid = String(item.placeId ?? "");
  const cid = String(item.cid     ?? "");
  return {
    title:        String(item.title        ?? ""),
    address:      String(item.address      ?? ""),
    category:     String(item.category     ?? ""),
    phone:        String(item.phoneNumber  ?? ""),
    website:      String(item.website      ?? ""),
    rating:       Number(item.rating)      || 0,
    ratingCount:  Number(item.ratingCount) || 0,
    latitude:     Number(item.latitude)    || 0,
    longitude:    Number(item.longitude)   || 0,
    placeId: pid,
    cid,
    mapsUrl: pid
      ? `https://www.google.com/maps/place/?q=place_id:${pid}`
      : cid ? `https://www.google.com/maps?cid=${cid}` : "",
    openNow:      typeof item.openNow === "boolean" ? item.openNow : null,
    priceLevel:   String(item.priceLevel  ?? ""),
    thumbnailUrl: String(item.thumbnailUrl ?? ""),
    openingHours: Array.isArray(item.openingHours)
      ? item.openingHours.map(String)
      : [],
    query,
    location,
  };
}

export function dedupKey(item: Place): string {
  if (item.placeId) return `pid:${item.placeId}`;
  if (item.cid)     return `cid:${item.cid}`;
  const addr = item.address.slice(0, 30).toLowerCase().replace(/\s+/g, " ").trim();
  return `ttl:${item.title.toLowerCase()}|${addr}`;
}

export async function fetchPage(
  q: string, loc: string, start: number,
  apiKey: string, gl: string, hl: string, num: number
): Promise<FetchResult> {
  const key = cacheKey(q, loc, start, gl, hl);

  const cached = cacheGet(key);
  if (cached) return { places: cached, status: 200, errMsg: "", fromCache: true };

  const payload: Record<string, unknown> = { q, location: loc, gl, hl, num };
  if (start) payload.start = start;

  const resp = await fetch("https://google.serper.dev/maps", {
    method:  "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(25_000),
  });

  if (!resp.ok) {
    let errMsg = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      errMsg = body?.message ?? body?.error ?? body?.msg ?? errMsg;
    } catch { }
    return { places: [], status: resp.status, errMsg, fromCache: false };
  }

  const data   = await resp.json();
  const places = data.places ?? [];
  cacheSet(key, places);
  return { places, status: 200, errMsg: "", fromCache: false };
}
