#!/usr/bin/env python3
"""Sitedeki mevcut ilanlardan mükerrer kontrol kaydı (gorulen-ilanlar.json) üretir.

Her ilan için platform, platform ilan kimliği, normalize bağlantı, ad, bölge,
adres, koordinat, kapasite, oda/banyo sayısı ve aynı mülk bağlantısı tutulur.
Yeni aramada önce platform+ilan kimliği, sonra koordinat/adres+oda yakınlığı
ile eşleşme aranır.
"""
import glob, json, re, os
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = sorted(glob.glob(f"{ROOT}/bolunmus-*.json") + glob.glob(f"{ROOT}/galeri-veri.json")
               + glob.glob(f"{ROOT}/six/prepared/*.json"))
points = {}
mp = json.load(open(f"{ROOT}/redesign-prototip/map-points.json"))
for r in mp.get("records", []):
    points.setdefault(r["id"], r)

def platform_of(url):
    h = urlparse(url or "").netloc.lower()
    for k in ["airbnb", "booking", "vrbo", "fewo-direkt", "holidu", "travanto", "traum-ferienwohnungen",
              "e-domizil", "ferienhausmiete", "hometogo", "casamundo", "belvilla", "expedia", "hotels.com"]:
        if k in h:
            return k
    return h or None

def listing_key(url):
    if not url:
        return None
    u = urlparse(url)
    p = platform_of(url)
    m = re.search(r"/rooms/(\d+)", u.path)
    if m: return f"airbnb:{m.group(1)}"
    m = re.search(r"/hotel/[a-z]{2}/([^./]+)", u.path)
    if m: return f"booking:{m.group(1)}"
    m = re.search(r"(\d{5,})", u.path)
    if m: return f"{p}:{m.group(1)}"
    return f"{p}:{u.netloc}{u.path.rstrip('/')}"

def norm_url(url):
    if not url: return None
    u = urlparse(url)
    return f"https://{u.netloc.replace('www.','').replace('airbnb.com.tr','airbnb.com')}{u.path}".rstrip('/')

out = {}
for f in FILES:
    data = json.load(open(f))
    if not isinstance(data, list):
        continue
    for it in data:
        link = it.get("link") or it.get("sourceURL")
        key = listing_key(link) or f"id:{it.get('id')}"
        pt = points.get(it.get("id")) or {}
        coords = it.get("coords")
        if not coords and pt:
            coords = {"lat": pt.get("lat"), "lon": pt.get("lon"), "accuracy": pt.get("accuracy")}
        rec = out.setdefault(key, {
            "key": key, "siteIds": [], "platform": platform_of(link), "url": norm_url(link),
            "name": it.get("name"), "area": it.get("area"), "address": it.get("address"),
            "coords": coords, "kind": it.get("kind"), "capacity": it.get("capacity"),
            "rooms": it.get("rooms"), "baths": it.get("baths"),
            "samePropertyAs": it.get("samePropertyAs"), "sources": [], "status": "sitede"})
        if it.get("id") not in rec["siteIds"]:
            rec["siteIds"].append(it.get("id"))
        rel = os.path.relpath(f, ROOT)
        if rel not in rec["sources"]:
            rec["sources"].append(rel)
        for k in ["address", "coords", "samePropertyAs"]:
            if not rec.get(k) and it.get(k):
                rec[k] = it.get(k)

res = {"aciklama": "Sitede zaten bulunan ilanlar. Yeni adaylar bu kayda göre elenir; reddedilen veya sunulan adaylar da status ile eklenir.",
       "uretildi": "2026-11-07", "ilanlar": sorted(out.values(), key=lambda r: r["key"])}
json.dump(res, open(f"{ROOT}/aday-arama/gorulen-ilanlar.json", "w"), ensure_ascii=False, indent=1)
print(len(out), "ilan;", sum(1 for r in out.values() if r["coords"]), "koordinatlı")
