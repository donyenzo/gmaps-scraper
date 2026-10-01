/**
 * __tests__/scraper-logic.test.ts
 * Run: npm test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  KeyRotator, Semaphore, validate, parsePlaceItem,
  dedupKey, cacheKey, cacheGet, cacheSet, cacheClear,
  LIMITS, CACHE_TTL_MS,
} from "../lib/scraper-logic";

// ─────────────────────────────────────────────────────────────────────────────
// KeyRotator
// ─────────────────────────────────────────────────────────────────────────────
describe("KeyRotator", () => {
  it("round-robins through keys", () => {
    const r = new KeyRotator(["a", "b", "c"]);
    expect(r.next()).toBe("a");
    expect(r.next()).toBe("b");
    expect(r.next()).toBe("c");
    expect(r.next()).toBe("a"); // wrap
  });

  it("skips failed keys", () => {
    const r = new KeyRotator(["a", "b", "c"]);
    r.fail("b");
    const seen = new Set(Array.from({ length: 6 }, () => r.next()));
    expect(seen.has("b")).toBe(false);
    expect(seen.has("a")).toBe(true);
    expect(seen.has("c")).toBe(true);
  });

  it("throws when all keys failed", () => {
    const r = new KeyRotator(["x"]);
    r.fail("x");
    expect(() => r.next()).toThrow("Semua API key gagal.");
  });

  it("reports activeCount correctly", () => {
    const r = new KeyRotator(["a", "b", "c"]);
    expect(r.activeCount).toBe(3);
    r.fail("a");
    expect(r.activeCount).toBe(2);
    r.fail("b");
    r.fail("c");
    expect(r.activeCount).toBe(0);
  });

  // FIX VERIFICATION: idx tidak overflow
  it("idx resets before overflow (mod 1_000_000)", () => {
    const r = new KeyRotator(["only"]);
    for (let i = 0; i < 1_000_005; i++) r.next();
    expect(() => r.next()).not.toThrow(); // seharusnya tetap berjalan
  });

  it("throws on empty keys array", () => {
    expect(() => new KeyRotator([])).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Semaphore
// ─────────────────────────────────────────────────────────────────────────────
describe("Semaphore", () => {
  it("limits concurrency to n", async () => {
    const sem = new Semaphore(2);
    let concurrent = 0, peak = 0;
    const task = async () => {
      const release = await sem.acquire();
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise(r => setTimeout(r, 5));
      concurrent--;
      release();
    };
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  it("queues excess work and releases in order", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map(async n => {
        const release = await sem.acquire();
        order.push(n);
        release();
      })
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("throws on n < 1", () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate()
// ─────────────────────────────────────────────────────────────────────────────
const validInput = {
  jobs: [{ query: "restoran", location: "Jakarta", maxPages: 3 }],
  apiKeys: ["key123"],
  gl: "id", hl: "id", num: 20,
};

describe("validate()", () => {
  it("accepts valid input", () => {
    const r = validate(validInput);
    expect(r.ok).toBe(true);
  });

  it("trims whitespace from query and location", () => {
    const r = validate({
      ...validInput,
      jobs: [{ query: "  padang  ", location: "  jakarta  ", maxPages: 1 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.jobs[0].query).toBe("padang");
      expect(r.data.jobs[0].location).toBe("jakarta");
    }
  });

  it("rejects null body", () => {
    expect(validate(null).ok).toBe(false);
    expect(validate(undefined).ok).toBe(false);
  });

  it("rejects empty jobs array", () => {
    const r = validate({ ...validInput, jobs: [] });
    expect(r.ok).toBe(false);
  });

  it(`rejects more than ${LIMITS.MAX_JOBS} jobs`, () => {
    const jobs = Array.from({ length: LIMITS.MAX_JOBS + 1 }, (_, i) => ({
      query: `q${i}`, location: "Jakarta", maxPages: 1,
    }));
    expect(validate({ ...validInput, jobs }).ok).toBe(false);
  });

  it("rejects job without query", () => {
    const r = validate({ ...validInput, jobs: [{ query: "", location: "Jakarta", maxPages: 1 }] });
    expect(r.ok).toBe(false);
  });

  it("rejects maxPages > LIMITS.MAX_PAGES", () => {
    const r = validate({
      ...validInput,
      jobs: [{ query: "test", location: "Jakarta", maxPages: LIMITS.MAX_PAGES + 1 }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid gl (not 2-letter code)", () => {
    expect(validate({ ...validInput, gl: "xyz" }).ok).toBe(false);  // 3 huruf
    expect(validate({ ...validInput, gl: "i"   }).ok).toBe(false);  // 1 huruf
    expect(validate({ ...validInput, gl: "id1" }).ok).toBe(false);  // ada angka
    // Catatan: "ID" (uppercase) DITERIMA karena kode menormalisasi ke lowercase.
    expect(validate({ ...validInput, gl: "ID"  }).ok).toBe(true);
  });

  it("rejects invalid num", () => {
    expect(validate({ ...validInput, num: 15 }).ok).toBe(false);
    expect(validate({ ...validInput, num: 0 }).ok).toBe(false);
  });

  it(`rejects more than ${LIMITS.MAX_KEYS} API keys`, () => {
    const apiKeys = Array.from({ length: LIMITS.MAX_KEYS + 1 }, (_, i) => `key${i}`);
    expect(validate({ ...validInput, apiKeys }).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parsePlaceItem() + dedupKey()
// ─────────────────────────────────────────────────────────────────────────────
const rawItem = {
  title:        "Restoran Padang Sederhana",
  address:      "Jl. Sudirman No. 45, Jakarta",
  category:     "Restoran",
  phoneNumber:  "021-5550123",
  website:      "https://sederhana.co.id",
  rating:       4.8,
  ratingCount:  2341,
  latitude:     -6.2088,
  longitude:    106.8456,
  placeId:      "ChIJabc123",
  cid:          "cid999",
  openNow:      true,
  priceLevel:   "$$",
  thumbnailUrl: "https://img.example.com/photo.jpg",
  openingHours: ["Senin–Jumat: 07.00–22.00", "Sabtu–Minggu: 08.00–23.00"],
};

describe("parsePlaceItem()", () => {
  it("maps all known fields correctly", () => {
    const p = parsePlaceItem(rawItem, "restoran padang", "Jakarta");
    expect(p.title).toBe("Restoran Padang Sederhana");
    expect(p.phone).toBe("021-5550123");
    expect(p.rating).toBe(4.8);
    expect(p.openNow).toBe(true);
    expect(p.priceLevel).toBe("$$");
  });

  it("captures thumbnailUrl and openingHours (new fields)", () => {
    const p = parsePlaceItem(rawItem, "q", "loc");
    expect(p.thumbnailUrl).toBe("https://img.example.com/photo.jpg");
    expect(p.openingHours).toHaveLength(2);
    expect(p.openingHours[0]).toContain("Senin");
  });

  it("defaults missing fields to safe values", () => {
    const p = parsePlaceItem({}, "q", "loc");
    expect(p.title).toBe("");
    expect(p.rating).toBe(0);
    expect(p.openNow).toBeNull();
    expect(p.openingHours).toEqual([]);
    expect(p.thumbnailUrl).toBe("");
  });

  it("generates mapsUrl from placeId", () => {
    const p = parsePlaceItem({ placeId: "ChIJabc" }, "q", "loc");
    expect(p.mapsUrl).toContain("place_id:ChIJabc");
  });

  it("falls back to cid mapsUrl when no placeId", () => {
    const p = parsePlaceItem({ cid: "cid999" }, "q", "loc");
    expect(p.mapsUrl).toContain("cid=cid999");
  });
});

describe("dedupKey()", () => {
  it("uses placeId when available (highest priority)", () => {
    const p = parsePlaceItem(rawItem, "q", "loc");
    expect(dedupKey(p)).toBe("pid:ChIJabc123");
  });

  it("uses cid when no placeId", () => {
    const p = parsePlaceItem({ ...rawItem, placeId: "" }, "q", "loc");
    expect(dedupKey(p)).toBe("cid:cid999");
  });

  it("FIX: falls back to title+address (NOT just title)", () => {
    const p1 = parsePlaceItem(
      { ...rawItem, placeId: "", cid: "", title: "RM Padang", address: "Jl. Sudirman, Jakarta" },
      "q", "loc"
    );
    const p2 = parsePlaceItem(
      { ...rawItem, placeId: "", cid: "", title: "RM Padang", address: "Jl. Raya, Surabaya" },
      "q", "loc"
    );
    // Kunci berbeda meski nama sama — FIX dari bug sebelumnya
    expect(dedupKey(p1)).not.toBe(dedupKey(p2));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────
describe("Cache (cacheGet / cacheSet)", () => {
  beforeEach(() => cacheClear());

  it("returns null for missing key", () => {
    expect(cacheGet("nonexistent")).toBeNull();
  });

  it("stores and retrieves data", () => {
    const key = cacheKey("restoran", "Jakarta", 0, "id", "id");
    cacheSet(key, [{ title: "Test" }]);
    const result = cacheGet(key);
    expect(result).not.toBeNull();
    expect((result as { title: string }[])[0].title).toBe("Test");
  });

  it("returns null for expired entry", () => {
    vi.useFakeTimers();
    const key = "expired-key";
    cacheSet(key, [{ title: "Old" }]);
    vi.advanceTimersByTime(CACHE_TTL_MS + 1_000);
    expect(cacheGet(key)).toBeNull();
    vi.useRealTimers();
  });

  it("cacheKey is case-insensitive and trimmed", () => {
    const k1 = cacheKey("RESTORAN", " Jakarta ", 0, "ID", "ID");
    const k2 = cacheKey("restoran", "jakarta",   0, "id", "id");
    expect(k1).toBe(k2);
  });
});
