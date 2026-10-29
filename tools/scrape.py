#!/usr/bin/env python3
"""学祭ポータル (gakusai-search.github.io) から企画と団体を取り込み、data/fest.json に書く。

  python3 tools/scrape.py                 # サイトから取る
  python3 tools/scrape.py --cache DIR     # 保存済みの HTML から作る（DIR/2026_events_xxx.html など）

中身（取得時刻を除く）が前と同じなら書き換えない。次のときは書かずに失敗する（Actions が失敗として知らせる）:
  - 題名・日時・場所のどれかが読めない企画がある
  - 企画が前より 3 件以上減った・団体が 0 件
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://gakusai-search.github.io"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "fest.json")
POSTERS = os.path.join(ROOT, "img", "posters")
UA = "fest-info-miyasui (+https://github.com/Omupp/fest-info-miyasui)"
JST = timezone(timedelta(hours=9))
PLACEHOLDER = "events_hero_example"
YEAR = "2026"  # この年の企画だけ（ほかの年・大学が足されても混ぜない）

# 気になる条件（表示に使う）。それ以外のタグは日程・形式・分野
CONDITIONS = ["予約不要", "予約必須", "完全無料", "キッズ歓迎", "撮影OK", "途中入退場OK",
              "常時開催", "キャッシュレス可", "イートインあり", "高校生・受験生応援"]


def fetch(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def text(s):
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def first(pattern, s, default=""):
    m = re.search(pattern, s, flags=re.S)
    return text(m.group(1)) if m else default


def strip_cid(s):
    s = re.sub(r"<style.*?</style>|<script.*?</script>|<svg.*?</svg>", "", s, flags=re.S)
    return re.sub(r" data-astro-cid-\w+", "", s)


def parse_sessions(dt):
    """「10月31日（土）終日 および 11月1日（日）12:20〜12:40, 13:20〜13:40」→ 日ごとの枠"""
    out = []
    for part in re.split(r"および|、(?=\d+月)", dt):
        m = re.search(r"(\d+)月(\d+)日", part)
        if not m:
            continue
        day = f"{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        times = re.findall(r"(\d{1,2}:\d{2})\s*[〜～~\-－]\s*(\d{1,2}:\d{2})", part)
        if times:
            for a, b in times:
                out.append({"day": day, "start": a.zfill(5), "end": b.zfill(5)})
        elif "終日" in part:
            out.append({"day": day, "allday": True})
        else:
            start = re.search(r"(\d{1,2}:\d{2})", part)
            out.append({"day": day, "start": start.group(1).zfill(5)} if start else {"day": day, "allday": True})
    return out


def parse_event(slug, s):
    s = strip_cid(s)
    img = re.search(r'<img class="image-relative" src="([^"]+)"', s)
    image = img.group(1) if img and PLACEHOLDER not in img.group(1) else None
    image_local = None
    if image:
        stem = os.path.splitext(os.path.basename(image))[0]
        if os.path.exists(os.path.join(POSTERS, stem + ".jpg")):
            image_local = f"img/posters/{stem}.jpg"
    org = re.search(r'<a href="/organizers/([^"]+)" class="organizer-btn"><span class="organizer-btn-name">(.*?)</span>', s, flags=re.S)
    tag_block = re.search(r'<section class="button-list">(.*?)</section>', s, flags=re.S)
    tags = [text(t).lstrip("#") for t in re.findall(r"<button[^>]*>(.*?)</button>", tag_block.group(1), flags=re.S)] if tag_block else []
    date_text = first(r'<div class="date"><h2>開催日時</h2><p>(.*?)</p>', s)
    place_block = re.search(r'<div class="place"><h2>場所</h2>(.*?)</div>', s, flags=re.S)
    place_ps = [text(p) for p in re.findall(r"<p>(.*?)</p>", place_block.group(1), flags=re.S)] if place_block else []
    room_text = place_ps[1] if len(place_ps) > 1 else (place_ps[0] if place_ps else "")
    fm = re.match(r"(\d+)階\s*(.*)", room_text)
    accounts_block = re.search(r'<div class="accounts"><h2>公式アカウント</h2>(.*?)</div>', s, flags=re.S)
    accounts = []
    if accounts_block:
        for href, label in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', accounts_block.group(1), flags=re.S):
            accounts.append({"url": html.unescape(href), "label": text(label)})
    sessions = parse_sessions(date_text)
    if not sessions:  # 日時の文が読めないときは日程のタグから
        for t in tags:
            m = re.match(r"(\d+)月(\d+)日", t)
            if m:
                sessions.append({"day": f"{int(m.group(1)):02d}-{int(m.group(2)):02d}", "allday": True})
    return {
        "id": slug,
        "title": first(r'<h1 class="event-title">(.*?)</h1>', s),
        "organizer": {"id": org.group(1), "name": text(org.group(2))} if org else None,
        "description": first(r'<p class="event-description">(.*?)</p>', s),
        "tags": tags,
        "conditions": [t for t in tags if t in CONDITIONS],
        "date_text": date_text,
        "sessions": sessions,
        "campus": place_ps[0] if place_ps else "",
        "floor": int(fm.group(1)) if fm else None,
        "room": (fm.group(2) if fm else room_text).strip(),
        "image": BASE + image if image else None,
        "image_local": image_local,
        "accounts": accounts,
        "url": f"{BASE}/2026/events/{slug}/",
    }


def parse_organizer(slug, s):
    s = strip_cid(s)
    desc_block = re.search(r'<div class="organizer-description">(.*?)</div>', s, flags=re.S)
    desc = "\n".join(text(p) for p in re.findall(r"<p>(.*?)</p>", desc_block.group(1), flags=re.S)) if desc_block else ""
    links = []
    for svc, href, label in re.findall(r'<div class="account-item"><span class="account-service">(.*?)</span><a href="([^"]+)"[^>]*>(.*?)</a>', s, flags=re.S):
        links.append({"service": text(svc), "url": html.unescape(href), "label": text(label)})
    return {
        "id": slug,
        "name": first(r'<div class="page-title"><h1>(.*?)</h1>', s),
        "description": desc,
        "links": links,
        "url": f"{BASE}/organizers/{slug}/",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="保存済みの HTML のフォルダ（サイトに取りに行かない）")
    args = ap.parse_args()

    def get(path):
        if args.cache:
            name = path.strip("/").replace("/", "_") or "index"
            with open(os.path.join(args.cache, name + ".html"), encoding="utf-8") as f:
                return f.read()
        time.sleep(1)  # 相手のサイトに負担をかけない
        return fetch(path)

    if args.cache:
        names = sorted(os.listdir(args.cache))
        paths = ["/" + n[:-5].replace("_events_", "/events/", 1).replace("organizers_", "organizers/", 1) + "/"
                 for n in names if n.endswith(".html")]
    else:
        idx = fetch("/sitemap-index.xml")
        paths = []
        for sm in re.findall(r"<loc>(.*?)</loc>", idx):
            body = fetch(sm.replace(BASE, ""))
            paths += [u.replace(BASE, "") for u in re.findall(r"<loc>(.*?)</loc>", body)]

    events, organizers = [], []
    for p in paths:
        m = re.fullmatch(r"/(\d{4})/events/([^/]+)/?", p)
        if m and m.group(1) == YEAR:
            events.append(parse_event(m.group(2), get(p)))
            continue
        m = re.fullmatch(r"/organizers/([^/]+)/?", p)
        if m:
            organizers.append(parse_organizer(m.group(1), get(p)))

    bad = [e["id"] for e in events if not e["title"] or not e["sessions"] or not e["room"]]
    if bad:
        sys.exit(f"題名・日時・場所が読めない企画があるので書き換えない: {bad}")

    old = None
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    if not events or (old and len(events) <= len(old.get("events", [])) - 3):
        sys.exit(f"企画が {len(events)} 件しか読めなかったので書き換えない")
    if not organizers:
        sys.exit("団体が読めなかったので書き換えない")

    events.sort(key=lambda e: (e["floor"] or 99, e["room"], e["title"]))
    organizers.sort(key=lambda o: o["name"])
    data = {"source": BASE + "/", "events": events, "organizers": organizers}
    if old and {k: v for k, v in old.items() if k != "updated_at"} == data:
        print(f"変化なし（企画 {len(events)}・団体 {len(organizers)}）")
        return
    data = {"updated_at": datetime.now(JST).strftime("%Y-%m-%dT%H:%M+09:00"), **data}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"更新しました（企画 {len(events)}・団体 {len(organizers)}）")


if __name__ == "__main__":
    main()
