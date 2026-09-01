#!/usr/bin/env python3
"""Smoke compare: TotalPass Python scraper vs list API only (Poá-SP)."""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

import requests

BASE_URL = "https://totalpass.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TotalPassScraperTemplate/1.0; +educacional)",
    "Accept-Language": "pt-BR,pt;q=0.9",
}
session = requests.Session()
session.headers.update(HEADERS)
RESULT_CAP = 200


def geocode_city(city_query: str) -> tuple[float, float, str]:
    resp = session.get(
        f"{BASE_URL}/api/website/places",
        params={"street": city_query, "locale": "pt-BR"},
        timeout=15,
    )
    resp.raise_for_status()
    suggestions = resp.json().get("data", [])
    if not suggestions:
        raise ValueError(f"No geocode for {city_query}")
    best = suggestions[0]
    place_id = best["attributes"]["place_id"]
    formatted = best["attributes"]["formatted_address"]
    resp2 = session.get(
        f"{BASE_URL}/api/website/place",
        params={"place": place_id, "locale": "pt-BR"},
        timeout=15,
    )
    resp2.raise_for_status()
    attrs = resp2.json()["data"]["attributes"]
    return attrs["latitude"], attrs["longitude"], formatted


def _fetch_gyms_raw(lat: float, lng: float, km_radius: float) -> list[dict]:
    params = {
        "locale": "pt-BR",
        "current_location[latitude]": lat,
        "current_location[longitude]": lng,
        "location[latitude]": lat,
        "location[longitude]": lng,
        "km_radius": km_radius,
    }
    resp = session.get(f"{BASE_URL}/api/website/gyms", params=params, timeout=20)
    resp.raise_for_status()
    return resp.json().get("data", [])


def list_gyms_tiled(lat: float, lng: float, km_radius: float = 10, _seen: dict | None = None) -> list[dict]:
    if _seen is None:
        _seen = {}
    gyms = _fetch_gyms_raw(lat, lng, km_radius)
    for g in gyms:
        _seen[g["id"]] = g
    if len(gyms) >= RESULT_CAP and km_radius > 1.5:
        offset_deg = (km_radius / 2) / 111.0
        sub_radius = km_radius / 1.5
        for sub_lat, sub_lng in [
            (lat + offset_deg, lng + offset_deg),
            (lat + offset_deg, lng - offset_deg),
            (lat - offset_deg, lng + offset_deg),
            (lat - offset_deg, lng - offset_deg),
        ]:
            list_gyms_tiled(sub_lat, sub_lng, sub_radius, _seen=_seen)
    return list(_seen.values())


def extract_jsonld(html: str) -> dict:
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return {}


def _unescape_js_string(s: str) -> str:
    try:
        return json.loads(f'"{s}"')
    except json.JSONDecodeError:
        return s


def _scalar_field(html: str, key: str) -> str | None:
    m = re.search(r'\\"' + re.escape(key) + r'\\":\\"(.*?)\\"', html)
    return _unescape_js_string(m.group(1)) if m else None


def _array_block(html: str, key: str) -> str | None:
    m = re.search(r'\\"' + re.escape(key) + r'\\":\[(.*?)\]', html)
    return m.group(1) if m else None


def extract_modalidades(html: str) -> list[str]:
    block = _array_block(html, "modalities")
    if not block:
        return []
    return [_unescape_js_string(n) for n in re.findall(r'\\"translated_name\\":\\"(.*?)\\"', block)]


def scrape_detail(slug: str) -> dict[str, Any]:
    url = f"{BASE_URL}/br/academias/{slug}/"
    resp = session.get(url, timeout=20)
    resp.raise_for_status()
    html = resp.text
    jsonld = extract_jsonld(html)
    return {
        "url": url,
        "jsonld_address": jsonld.get("address"),
        "jsonld_phone": jsonld.get("telephone"),
        "jsonld_hours": jsonld.get("openingHours"),
        "modalidades": extract_modalidades(html),
        "email": _scalar_field(html, "email"),
        "instagram_ou_site": _scalar_field(html, "website"),
    }


def main() -> None:
    city = sys.argv[1] if len(sys.argv) > 1 else "Poá, SP"
    radius = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
    lat, lng, formatted = geocode_city(city)
    tiled = list_gyms_tiled(lat, lng, radius)
    single = _fetch_gyms_raw(lat, lng, radius)

    # detail sample (first 3)
    details = []
    for g in tiled[:3]:
        slug = g["attributes"].get("slug")
        if not slug:
            continue
        try:
            details.append({"nome": g["attributes"].get("name"), **scrape_detail(slug)})
            time.sleep(0.4)
        except Exception as exc:  # noqa: BLE001
            details.append({"nome": g["attributes"].get("name"), "error": str(exc)})

    out = {
        "city": city,
        "formatted": formatted,
        "coords": {"lat": lat, "lng": lng},
        "radius_km": radius,
        "single_call_count": len(single),
        "tiled_count": len(tiled),
        "hit_cap_single": len(single) >= RESULT_CAP,
        "detail_samples": details,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
