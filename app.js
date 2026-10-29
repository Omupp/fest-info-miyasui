"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u || "") ? u : "#");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let FEST, EVENTS, ORGS, BY_ID;
const state = { ttDay: null, pfDay: "all", q: "" };

function jstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  const key = String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  return { key, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

const place = (e) => [e.floor ? `${e.floor}階` : "", e.room].filter(Boolean).join(" ");

// 予約が要るか（ポケモン部は大会だけ予約制）
function mustLabel(e) {
  if (!e.conditions.includes("予約必須")) return "";
  return e.conditions.includes("予約不要") ? "一部予約必須" : "予約必須";
}
const mustTag = (e) => (mustLabel(e) ? `<span class="tag must">${mustLabel(e)}</span>` : "");

function condText(e) {
  const c = new Set(e.conditions);
  const out = [];
  if (c.has("予約不要") && !c.has("予約必須")) out.push("予約不要");
  if (c.has("完全無料")) out.push("無料");
  for (const k of ["キッズ歓迎", "撮影OK", "途中入退場OK", "キャッシュレス可", "イートインあり", "高校生・受験生応援"]) if (c.has(k)) out.push(k);
  return out.join("・");
}

function when(e) {
  const per = FEST.days
    .map((d) => {
      const ss = e.sessions.filter((s) => s.day === d.key);
      if (!ss.length) return null;
      const txt = ss.some((s) => s.allday) ? "終日" : ss.map((s) => (s.end ? `${s.start}〜${s.end}` : `${s.start}〜`)).join("、");
      return { label: d.label, txt };
    })
    .filter(Boolean);
  if (per.length === FEST.days.length && per.every((p) => p.txt === per[0].txt)) return `両日 ${per[0].txt}`;
  return per.map((p) => `${p.label} ${p.txt}`).join("、");
}

/* ---------- 詳細 ---------- */

function detailHTML(e) {
  const img = e.image_local || e.image;
  const cond = condText(e);
  return `<article class="ev">
    ${img ? `<div class="ev-img"><img src="${esc(img)}" alt="${esc(e.title)}のポスター" width="960" height="540"></div>` : ""}
    <h3>${esc(e.title)}</h3>
    ${e.organizer ? `<p class="org">${esc(e.organizer.name)}</p>` : ""}
    ${mustLabel(e) ? `<p class="must-line">${mustTag(e)}</p>` : ""}
    <dl><dt>日時</dt><dd>${esc(when(e))}</dd><dt>場所</dt><dd>${esc(place(e))}</dd></dl>
    ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ""}
    ${lineupHTML(e)}
    ${e.notes.length ? `<ul class="notes">${e.notes.map((n) => `<li><span class="from">${esc(n.from)}より</span>${esc(n.text)}</li>`).join("")}</ul>` : ""}
    ${cond ? `<p class="conds">${esc(cond)}</p>` : ""}
    <p class="src"><a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">学祭ポータルで見る</a></p>
  </article>`;
}

// 出演順（軽音など）。演奏中・終わった組・休憩を示す
function lineupHTML(e) {
  if (!e.lineup.length) return "";
  const now = jstNow();
  return FEST.days.map((d) => {
    const bs = e.lineup.filter((b) => b.day === d.key);
    if (!bs.length) return "";
    const lis = bs.map((b, i) => {
      const st = now.key !== d.key ? "" : b.endMin <= now.min ? "done" : b.startMin <= now.min ? "on" : "";
      const gap = bs[i + 1] && bs[i + 1].startMin > b.endMin ? `<li class="brk"><span class="tnum">${fmt(b.endMin)}</span><span>休憩</span></li>` : "";
      return `<li class="${st}"><span class="tnum">${fmt(b.startMin)}</span><span>${esc(b.name)}${st === "on" ? `<span class="tag live">演奏中</span>` : ""}</span></li>${gap}`;
    }).join("");
    return `<h4 class="lu-head">出演 ${esc(d.label)}<small>${esc(e.lineupFrom || "")}より</small></h4><ol class="lineup">${lis}</ol>`;
  }).join("");
}

function openDetail(id) {
  const e = BY_ID.get(id);
  if (!e) return;
  $("dlg-body").innerHTML = detailHTML(e);
  const d = $("detail");
  if (!d.open) d.showModal();
  d.scrollTop = 0;
}

/* ---------- タイムテーブル ---------- */

// 時刻の決まった枠（学祭ポータルの時刻＋ポスターから補った時刻）
function timedItems(day) {
  const items = [];
  for (const e of EVENTS) {
    const own = e.sessions.filter((s) => s.day === day && s.start);
    const extra = e.extraSessions.filter((s) => s.day === day);
    for (const s of [...own, ...extra]) {
      const start = toMin(s.start);
      items.push({
        e, start, end: s.end ? toMin(s.end) : start + 60,
        name: s.label || e.title,
        sub: s.label ? e.title : s.sub || "",
        lineup: e.lineup.filter((b) => b.day === day && b.startMin >= start && b.startMin < (s.end ? toMin(s.end) : start + 60)),
      });
    }
  }
  return items.sort((a, b) => a.start - b.start || (a.e.floor ?? 99) - (b.e.floor ?? 99));
}

function alldayItems(day) {
  return EVENTS.filter((e) => e.sessions.some((s) => s.day === day && s.allday) && !(e.replaceAllday && e.extraSessions.some((s) => s.day === day)));
}

function liveState(it, now, day) {
  if (now.key !== day) return "";
  if (it.end <= now.min) return "past";
  if (it.start <= now.min) return "live";
  return "";
}

// 一覧の 2 行目：出演順があれば「いま ○○・つぎ ○○」か「○組が出演」
function subText(it, st) {
  if (!it.lineup.length) return it.sub;
  if (st !== "live") return `${it.lineup.length}組が出演`;
  const m = jstNow().min;
  const cur = it.lineup.find((b) => b.startMin <= m && m < b.endMin);
  const next = it.lineup.find((b) => b.startMin > m);
  return [cur && `いま ${cur.name}`, next && `つぎ ${fmt(next.startMin)} ${next.name}`].filter(Boolean).join("・");
}

function timedRow(it, st) {
  return `<li><button type="button" class="row ${st}" data-id="${esc(it.e.id)}">
    <span class="r-time tnum"><b>${fmt(it.start)}</b><small>〜${fmt(it.end)}</small></span>
    <span class="r-main">
      <span class="r-title">${esc(it.name)}</span>
      <span class="r-meta">${esc(place(it.e))}${st === "live" ? `<span class="tag live">開催中</span>` : ""}${mustTag(it.e)}</span>
      ${subText(it, st) ? `<span class="r-meta">${esc(subText(it, st))}</span>` : ""}
    </span>
  </button></li>`;
}

function renderNow(items) {
  const now = jstNow();
  const box = $("nowbox");
  const open = toMin(FEST.open), close = toMin(FEST.close);
  if (now.key !== state.ttDay || now.min >= close) { box.innerHTML = ""; return; }
  const live = items.filter((it) => it.start <= now.min && now.min < it.end);
  const next = items.filter((it) => it.start > now.min).slice(0, 3);
  const inHours = now.min >= open;
  box.innerHTML = `<section class="nowbox" aria-label="いま">
    <h2>${inHours ? "いま" : "開場前"}<span class="clock tnum">${fmt(now.min)}</span></h2>
    ${live.length ? `<ul class="rows">${live.map((it) => timedRow(it, "live")).join("")}</ul>` : ""}
    ${next.length ? `<h3>このあと</h3><ul class="rows">${next.map((it) => timedRow(it, "")).join("")}</ul>` : ""}
  </section>`;
}

function renderGrid(items, from, to) {
  const pxPerMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) / 60;
  const height = (to - from) * pxPerMin;
  const now = jstNow();
  const cols = new Map();
  for (const it of items) {
    const k = `${String(it.e.floor ?? 99).padStart(2, "0")}|${it.e.room}`;
    if (!cols.has(k)) cols.set(k, { floor: it.e.floor, room: it.e.room, items: [] });
    cols.get(k).items.push(it);
  }
  let html = `<div class="tt-col axis"><div class="tt-head"></div><div class="tt-body" style="height:${height}px">`;
  for (let m = from; m <= to; m += 60) html += `<span class="hour tnum" style="top:${(m - from) * pxPerMin}px">${m / 60}:00</span>`;
  html += `</div></div>`;
  for (const [, c] of [...cols.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
    // 重なったら横に並べる
    const lanes = [];
    for (const it of c.items) {
      let l = lanes.findIndex((end) => end <= it.start);
      if (l < 0) { l = lanes.length; lanes.push(0); }
      lanes[l] = it.end;
      it.lane = l;
    }
    const n = Math.max(1, lanes.length);
    html += `<div class="tt-col"><div class="tt-head">${c.floor ? `<span>${c.floor}階</span>` : ""}<b>${esc(c.room)}</b></div><div class="tt-body" style="height:${height}px">`;
    for (const it of c.items) {
      const short = it.end - it.start < 45;
      const st = liveState(it, now, state.ttDay);
      const lane = n > 1 ? `left:calc(${(100 / n) * it.lane}% + 4px);right:auto;width:calc(${100 / n}% - 8px);` : "";
      const lu = it.lineup.length && !short;
      html += `<button type="button" class="blk ${short ? "short" : ""} ${lu ? "has-lu" : ""} ${st}" data-id="${esc(it.e.id)}" style="top:${(it.start - from) * pxPerMin}px;height:${Math.max(20, (it.end - it.start) * pxPerMin - 2)}px;${lane}">`
        + `<span class="t tnum">${short ? fmt(it.start) : `${fmt(it.start)}〜${fmt(it.end)}`}${short ? "" : mustTag(it.e)}</span><span class="n">${esc(it.name)}</span>`
        + (!short && it.sub ? `<span class="s">${esc(it.sub)}</span>` : "")
        + (lu ? it.lineup.map((b) => {
          const bs = now.key !== state.ttDay ? "" : b.endMin <= now.min ? "done" : b.startMin <= now.min ? "on" : "";
          return `<span class="lu ${bs}"><span class="tnum">${fmt(b.startMin)}</span> ${esc(b.name)}</span>`;
        }).join("") : "")
        + `</button>`;
    }
    html += `</div></div>`;
  }
  $("tt").innerHTML = html;
  if (now.key === state.ttDay && now.min >= from && now.min <= to) {
    for (const body of $("tt").querySelectorAll(".tt-body")) body.insertAdjacentHTML("beforeend", `<div class="nowline" style="top:${(now.min - from) * pxPerMin}px"></div>`);
  }
}

function renderTime() {
  const day = state.ttDay;
  renderDays($("tt-days"), FEST.days.map((d) => [d.key, d.label]), day, (k) => { state.ttDay = k; renderTime(); });
  const items = timedItems(day);
  let from = toMin(FEST.open), to = toMin(FEST.close);
  for (const it of items) { from = Math.min(from, Math.floor(it.start / 60) * 60); to = Math.max(to, Math.ceil(it.end / 60) * 60); }

  renderNow(items);
  const now = jstNow();
  $("tt-list").innerHTML = items.map((it) => timedRow(it, liveState(it, now, day))).join("") || `<li class="empty">なし</li>`;
  renderGrid(items, from, to);

  $("allday-head").innerHTML = `終日<small>${esc(FEST.open)}〜${esc(FEST.close)}</small>`;
  $("allday").innerHTML = alldayItems(day).map((e) => {
    // 一覧には時刻の入った注記を 1 文だけ（終日と同じ「10:00〜17:00」は書かない）
    const full = `${FEST.open}〜${FEST.close}`;
    const note = e.notes.flatMap((n) => n.text.split("。")).find((t) => /\d:\d\d/.test(t) && t.trim() !== full);
    return `<li><button type="button" class="row" data-id="${esc(e.id)}"><span class="r-main">
      <span class="r-title">${esc(e.title)}</span>
      <span class="r-meta">${esc(place(e))}${mustTag(e)}</span>
      ${note ? `<span class="r-meta">${esc(note.trim())}</span>` : ""}
    </span></button></li>`;
  }).join("") || `<li class="empty">なし</li>`;
}

/* ---------- パンフ ---------- */

function pamphRow(e) {
  const img = e.image_local || e.image;
  return `<li><button type="button" class="row" data-id="${esc(e.id)}">
    <span class="r-main">
      <span class="r-title">${esc(e.title)}</span>
      <span class="r-meta">${esc(e.room)}・${esc(when(e))}${mustTag(e)}</span>
      ${e.organizer ? `<span class="r-meta">${esc(e.organizer.name)}</span>` : ""}
    </span>
    ${img ? `<span class="r-thumb"><img src="${esc(img)}" alt="" loading="lazy" width="112" height="63"></span>` : ""}
  </button></li>`;
}

function renderPamph() {
  renderDays($("pf-days"), [["all", "すべて"], ...FEST.days.map((d) => [d.key, d.label])], state.pfDay, (k) => { state.pfDay = k; renderPamph(); });
  const words = norm(state.q).trim().split(/\s+/).filter(Boolean);
  const list = EVENTS.filter((e) => (state.pfDay === "all" || e.sessions.some((s) => s.day === state.pfDay)) && words.every((w) => e.haystack.includes(w)));
  const floors = new Map();
  for (const e of list) {
    const k = e.floor ?? 99;
    if (!floors.has(k)) floors.set(k, []);
    floors.get(k).push(e);
  }
  const keys = [...floors.keys()].sort((a, b) => a - b);
  const name = (f) => (f === 99 ? "その他" : `${f}階`);
  $("floor-nav").innerHTML = keys.length > 1 ? keys.map((f) => `<a href="#f-${f}" data-floor="${f}">${name(f)}</a>`).join("") : "";
  $("floors").innerHTML = keys.map((f) => `<section class="floor" id="f-${f}">
    <h2 class="sec">${name(f)}<small>${floors.get(f).length}件</small></h2>
    <ul class="rows">${floors.get(f).map(pamphRow).join("")}</ul>
  </section>`).join("");
  $("empty").hidden = list.length > 0;
}

function renderInfo() {
  const rows = [
    ["日時", `${FEST.days.map((d) => d.label).join("・")} ${FEST.open}〜${FEST.close}`],
    ["会場", `${FEST.campus}（${FEST.address}）`],
    ["テーマ", FEST.theme],
    ["注意", FEST.closed_floors],
  ];
  $("info").innerHTML = rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")
    + `<tr><th>公式</th><td>${FEST.links.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("・")}</td></tr>`;
}

function renderOrgs() {
  $("orgs").innerHTML = ORGS.map((o) => {
    const evs = EVENTS.filter((e) => e.organizer && e.organizer.id === o.id);
    // 元のサイトの「本Webサイト」はこのページのことではないので読み替える
    const desc = o.description.replace("本Webサイト", "学祭ポータル");
    return `<div class="org-item"><h3>${esc(o.name)}</h3>
      ${desc ? `<p>${esc(desc)}</p>` : ""}
      <p class="evs">${evs.map((e) => `<a href="#e-${esc(e.id)}" data-id="${esc(e.id)}">${esc(e.title)}</a>`).join("")}</p>
      ${o.links.length ? `<p class="links">${o.links.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.service)}</a>`).join("")}</p>` : ""}
    </div>`;
  }).join("");
}

// 一番下の「参考（一次情報）」：出どころごとの URL と、企画ごとの元のページ
function sourcesHTML() {
  const shown = (u) => { try { return decodeURI(u); } catch { return u; } };
  const li = (label, what, url) => `<li><span class="src-label">${esc(label)}</span>${what ? `<span class="src-what">${esc(what)}</span>` : ""}`
    + (url ? `<a class="src-url" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(shown(url))}</a>` : "") + `</li>`;
  const evs = [...EVENTS].sort((a, b) => a.title.localeCompare(b.title, "ja"));
  return `<section class="sources" aria-labelledby="src-h"><h2 id="src-h">参考（一次情報）</h2>
    <ul>${(FEST.sources || []).map((x) => li(x.label, x.what, x.url)).join("")}</ul>
    <details><summary>企画ごとのページ（${evs.length}件）</summary><ul>${evs.map((e) => li(e.title, "", e.url)).join("")}</ul></details>
  </section>`;
}

/* ---------- 共通 ---------- */

function renderDays(el, opts, cur, onPick) {
  el.innerHTML = opts.map(([k, l]) => `<button type="button" aria-pressed="${k === cur}" data-k="${esc(k)}">${esc(l)}</button>`).join("");
  el.onclick = (ev) => { const b = ev.target.closest("button"); if (b) onPick(b.dataset.k); };
}

function route() {
  if ($("detail").open) $("detail").close();
  const h = location.hash;
  const tab = h === "#pamph" || h.startsWith("#e-") ? "pamph" : "time";
  $("view-time").hidden = tab !== "time";
  $("view-pamph").hidden = tab !== "pamph";
  document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === tab ? "page" : "false"));
  // #e-企画 で直接開ける（共有用）
  if (h.startsWith("#e-")) openDetail(decodeURIComponent(h.slice(3)));
}

async function main() {
  const [fest, extra] = await Promise.all(["data/fest.json", "data/extra.json"].map((u) => fetch(u, { cache: "no-cache" }).then((r) => r.json())));
  FEST = extra.festival;
  ORGS = fest.organizers;
  EVENTS = fest.events.map((e) => {
    const x = extra.events[e.id] || {};
    const notes = x.notes || [];
    const sess = x.sessions || [];
    const lineup = (x.lineup || []).map((b, i, arr) => {
      const start = toMin(b.start);
      const s = sess.find((s) => s.day === b.day && toMin(s.start) <= start && start < toMin(s.end));
      const limit = s ? toMin(s.end) : start + 20;
      const nx = arr[i + 1];
      return { ...b, startMin: start, endMin: nx && nx.day === b.day && toMin(nx.start) <= limit ? toMin(nx.start) : limit };
    });
    return {
      ...e,
      notes,
      extraSessions: sess,
      lineup,
      lineupFrom: x.lineup_from,
      replaceAllday: !!x.replace_allday,
      haystack: norm([e.title, e.organizer?.name, e.description, place(e), e.tags.join(" "), notes.map((n) => n.text).join(" "), lineup.map((b) => b.name).join(" ")].join(" ")),
    };
  });
  BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

  const now = jstNow();
  state.ttDay = FEST.days.some((d) => d.key === now.key) ? now.key : FEST.days[0].key;

  $("site-sub").innerHTML = `<span class="when">${esc(FEST.days.map((d) => d.label).join("・"))} <span class="nw">${esc(FEST.open)}〜${esc(FEST.close)}</span></span><span class="where">${esc(FEST.campus)}</span>`;
  const upd = fest.updated_at ? fest.updated_at.replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, (_, m, d, t) => `${+m}/${+d} ${t}`) : "";
  $("foot").innerHTML = `<p>非公式のまとめです。最新の情報は<a href="https://itlfest.com/" target="_blank" rel="noopener">公式サイト</a>でご確認ください。</p>
    <p>企画の情報は<a href="${esc(safeUrl(fest.source))}" target="_blank" rel="noopener">学祭ポータル</a>（C3 | Creative Computing Club）から。画像と文章は iTLFest.実行委員会と各団体のものです。時刻の一部はポスターと公式サイトから補いました。</p>
    ${upd ? `<p>データの更新：${esc(upd)}</p>` : ""}
    ${sourcesHTML()}`;

  renderInfo();
  renderTime();
  renderPamph();
  renderOrgs();
  route();

  window.addEventListener("hashchange", route);
  $("q").addEventListener("input", (ev) => { state.q = ev.target.value; renderPamph(); });
  document.addEventListener("click", (ev) => {
    const fl = ev.target.closest("[data-floor]");
    if (fl) {
      ev.preventDefault();
      $(`f-${fl.dataset.floor}`).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    const t = ev.target.closest("[data-id]");
    if (!t || t.closest("dialog")) return;
    ev.preventDefault();
    openDetail(t.dataset.id);
  });
  $("dlg-close").onclick = () => $("detail").close();
  $("detail").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  $("detail").addEventListener("close", () => { if (location.hash.startsWith("#e-")) history.replaceState(null, "", "#pamph"); });
  setInterval(() => { if (!$("view-time").hidden) renderTime(); }, 60e3);
}

main().catch((err) => {
  console.error(err);
  document.querySelector("main").innerHTML = `<p class="empty">データを読み込めませんでした。</p>`;
});
