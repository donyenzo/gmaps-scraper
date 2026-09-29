# 🗺️ Google Maps Scraper — Serper.dev

Full-stack web scraper Google Maps berbasis **Next.js 14** + **Serper.dev API**.
Deploy ke Vercel, pakai lewat browser — aman dengan auth token & rate limiting.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

---

## 🔒 Keamanan

| Layer | Mekanisme | Status |
|-------|-----------|--------|
| Autentikasi | Bearer token (`SCRAPER_AUTH_TOKEN`) | ✅ |
| Rate Limiting | 10 req/menit per IP (in-memory) | ✅ |
| Input Validation | Sanitasi + clamp semua field | ✅ |
| CORS | Whitelist origin via `ALLOWED_ORIGIN` | ✅ |
| Env Keys | Hanya accessible setelah auth lolos | ✅ |

---

## 🚀 Deploy ke Vercel (5 menit)

### 1. Push ke GitHub

```bash
git init && git add .
git commit -m "feat: google maps scraper with security"
git remote add origin https://github.com/USERNAME/gmaps-scraper.git
git push -u origin main
```

### 2. Import di Vercel + set Environment Variables

Buka [vercel.com](https://vercel.com) → **Add New Project** → Import repo

Wajib set di **Settings → Environment Variables**:

```
SCRAPER_AUTH_TOKEN = <generate: openssl rand -hex 32>
```

Opsional tapi disarankan:
```
SERPER_API_KEYS   = key1,key2,key3,key4,key5
ALLOWED_ORIGIN    = https://nama-project.vercel.app
```

### 3. Deploy → Buka URL → Masukkan Auth Token di UI

---

## 💻 Lokal

```bash
npm install
cp .env.example .env.local
# Isi SCRAPER_AUTH_TOKEN di .env.local
npm run dev
```

Cek kesehatan app: `GET /api/health`

---

## 📊 Field hasil scraping

`title` · `address` · `category` · `phone` · `website` · `rating` · `ratingCount` ·
`latitude` · `longitude` · `placeId` · `mapsUrl` · `openNow` · `priceLevel` · `query` · `location`

---

## ⚠️ Catatan Timeout Vercel

| Plan | Max Duration | Rekomendasi max pages |
|------|-------------|----------------------|
| Hobby (gratis) | 10 detik | 1–2 halaman |
| Pro ($20/bln) | 60 detik | 5–10 halaman |

---

## 🛠️ Tech Stack

Next.js 14 · TypeScript · Tailwind CSS · Serper.dev · Web Streams API (NDJSON) · Vercel
