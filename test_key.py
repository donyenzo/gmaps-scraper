#!/usr/bin/env python3
"""
Cepat test API key Serper.dev kamu & lihat struktur response.
Usage: python test_key.py YOUR_API_KEY
"""

import sys
import json
import urllib.request

def test_key(api_key: str):
    url = "https://google.serper.dev/maps"
    payload = json.dumps({
        "q": "restoran",
        "location": "Jakarta, Indonesia",
        "gl": "id",
        "hl": "id",
        "num": 3
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            places = data.get("places", [])
            print(f"\n✅ Key valid! Ditemukan {len(places)} tempat.\n")
            print("─── Contoh field yang tersedia ───")
            if places:
                print(json.dumps(places[0], indent=2, ensure_ascii=False))
            print("\n─── Field lengkap per record ───")
            if places:
                print(list(places[0].keys()))
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"\n❌ HTTP {e.code}: {body}")
    except Exception as e:
        print(f"\n❌ Error: {e}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_key.py YOUR_API_KEY")
        sys.exit(1)
    test_key(sys.argv[1])
