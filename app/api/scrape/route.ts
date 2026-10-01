import { NextRequest } from "next/server";
import {
  KeyRotator, Semaphore, validate, parsePlaceItem,
  fetchPage, dedupKey, LIMITS,
  type Job, type Place,
} from "../../../lib/scraper-logic";

export const maxDuration = 60; // Vercel Pro: up to 300s, Hobby: 10s (set SCRAPER_TIMEOUT_MS=8000)

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY — Auth + Rate Limit (tetap di route, bukan di lib)
// ═══════════════════════════════════════════════════════════════════════════
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authenticate(req: NextRequest): boolean {
  const secret = process.env.SCRAPER_AUTH_TOKEN?.trim();
  if (!secret) { console.error("[SECURITY] SCRAPER_AUTH_TOKEN tidak di-set — menolak akses!"); return false; }
  const header = req.headers.get("authorization") ?? "";
  const token  = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  return timingSafeEqual(token, secret);
}

const rlStore = new Map<string, { hits: number; resetAt: number }>();
const RL_MAX = 10, RL_WINDOW = 60_000;

function rateLimit(ip: string): { pass: boolean; retryAfter: number } {
  const now = Date.now();
  const rec = rlStore.get(ip);
  if (rlStore.size > 200) for (const [k, v] of rlStore) if (now > v.resetAt) rlStore.delete(k);
  if (!rec || now > rec.resetAt) {
    rlStore.set(ip, { hits: 1, resetAt: now + RL_WINDOW });
    return { pass: true, retryAfter: 0 };
  }
  if (rec.hits >= RL_MAX) return { pass: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  rec.hits++;
  return { pass: true, retryAfter: 0 };
}

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? req.headers.get("x-real-ip")
    ?? "unknown";
}

// ═══════════════════════════════════════════════════════════════════════════
// SCRAPE ONE JOB (untuk dijalankan paralel)
// ═══════════════════════════════════════════════════════════════════════════
async function scrapeJob(
  job: Job,
  rotator: KeyRotator,
  seen: Set<string>,
  send: (obj: Record<string, unknown>) => void,
  gl: string, hl: string, num: number,
  deadlineAt: number,
): Promise<number> {
  send({ type: "job_start", query: job.query, location: job.location });
  let subtotal = 0;

  for (let page = 0; page < job.maxPages; page++) {
    // FIX: periksa deadline SEBELUM tiap halaman, bukan sesudah
    const remaining = deadlineAt - Date.now();
    if (remaining < 3_000) {
      send({
        type: "warn",
        msg:  `⏰ Mendekati batas waktu server — "${job.query}" berhenti di halaman ${page + 1}. ` +
              `Set SCRAPER_TIMEOUT_MS lebih besar atau kurangi jumlah halaman.`,
      });
      break;
    }

    if (rotator.activeCount === 0) {
      send({ type: "error", msg: "Semua API key gagal." });
      break;
    }

    send({ type: "page", query: job.query, page: page + 1, maxPages: job.maxPages });

    let result = { places: [] as unknown[], status: 0, errMsg: "", fromCache: false };

    for (let attempt = 0; attempt < 3; attempt++) {
      const key = rotator.next();
      try {
        result = await fetchPage(job.query, job.location, page * num, key, gl, hl, num);
        if (result.status === 200) break;
        if (result.status === 401 || result.status === 403) {
          rotator.fail(key);
          send({ type: "warn", msg: `Key ...${key.slice(-6)} dinonaktifkan: ${result.errMsg}` });
        } else {
          send({ type: "warn", msg: `Serper error: ${result.errMsg} (attempt ${attempt + 1})` });
          await new Promise(r => setTimeout(r, 1_200 * (attempt + 1)));
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: "warn", msg: `Timeout/network: ${msg}` });
        await new Promise(r => setTimeout(r, 1_200 * (attempt + 1)));
      }
    }

    if (!result.places.length) {
      send({ type: "no_more", query: job.query, page: page + 1 });
      break;
    }

    // Deduplicate & parse — FIX: pakai dedupKey() yang menyertakan address sebagai fallback
    const fresh: Place[] = [];
    for (const item of result.places) {
      const p   = parsePlaceItem(item, job.query, job.location);
      const uid = dedupKey(p);
      if (seen.has(uid)) continue;
      seen.add(uid);
      fresh.push(p);
    }

    subtotal += fresh.length;
    send({
      type:      "data",
      places:    fresh,
      count:     fresh.length,
      fromCache: result.fromCache,
    });

    if (result.fromCache)
      send({ type: "info", msg: `📦 "${job.query}" halaman ${page + 1} dari cache` });

    if (result.places.length < num) break; // halaman terakhir
    await new Promise(r => setTimeout(r, 350));
  }

  send({ type: "job_done", query: job.query, subtotal });
  return subtotal;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  if (!authenticate(req))
    return Response.json({ error: "Unauthorized." }, { status: 401 });

  const rl = rateLimit(ip);
  if (!rl.pass)
    return Response.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfter} detik.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return Response.json({ error: "Body JSON tidak valid" }, { status: 400 }); }

  const validation = validate(rawBody);
  if (!validation.ok)
    return Response.json({ error: validation.error }, { status: 422 });

  const { jobs, apiKeys: clientKeys, gl, hl, num } = validation.data;

  const envKeys = (process.env.SERPER_API_KEYS ?? "")
    .split(",").map(k => k.trim())
    .filter(k => k.length > 0 && k.length <= LIMITS.MAX_KEY_LEN);
  const allKeys = [...new Set([...envKeys, ...clientKeys])];

  if (!allKeys.length)
    return Response.json({ error: "Tidak ada API key yang valid." }, { status: 400 });

  // FIX: Vercel timeout deadline — set SCRAPER_TIMEOUT_MS=8000 untuk Hobby plan
  const TIMEOUT_MS = parseInt(process.env.SCRAPER_TIMEOUT_MS ?? "55000");
  const deadlineAt = Date.now() + TIMEOUT_MS;

  const rotator = new KeyRotator(allKeys);
  const seen    = new Set<string>();
  const enc     = new TextEncoder();

  // FIX: concurrency = min(jobs, keys, 5) — manfaatkan semua key secara paralel
  const CONCURRENCY = Math.min(jobs.length, allKeys.length, 5);
  const sem = new Semaphore(CONCURRENCY);

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (obj: Record<string, unknown>) =>
        ctrl.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

      try {
        send({
          type:        "init",
          totalJobs:   jobs.length,
          keyCount:    allKeys.length,
          concurrency: CONCURRENCY,                          // FIX: informasikan ke UI
          timeoutMs:   TIMEOUT_MS,
        });

        // FIX: Promise.all + Semaphore — semua job jalan PARALEL
        await Promise.all(
          jobs.map(async (job) => {
            const release = await sem.acquire();
            try {
              await scrapeJob(job, rotator, seen, send, gl, hl, num, deadlineAt);
            } finally {
              release();
            }
          })
        );

        send({ type: "done", total: seen.size });
      } catch (e: unknown) {
        send({ type: "fatal", msg: e instanceof Error ? e.message : String(e) });
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream; charset=utf-8",
      "Cache-Control":     "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
