"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u || "") ? u : "#");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();

let FEST, EVENTS, ORGS, BY_ID;
const state = { ttDay: null, pfDay: "all", q: "" };

function jstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  const key = String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  return { key, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function place(e) {
  return [e.floor ? `${e.floor}階` : "", e.room].filter(Boolean).join(" ");
}

function dayLabel(key) {
  return (FEST.days.find((d) => d.key === key) || { label: key }).label;
}

// 予約・無料などを短く
function conds(e) {
  const c = new Set(e.conditions);
  const out = [];
  if (c.has("予約必須") && c.has("予約不要")) out.push({ t: "一部予約必須", must: true });
  else if (c.has("予約必須")) out.push({ t: "予約必須", must: true });
  else if (c.has("予約不要")) out.push({ t: "予約不要" });
  if (c.has("完全無料")) out.push({ t: "無料" });
  for (const k of ["キッズ歓迎", "撮影OK", "途中入退場OK", "キャッシュレス可", "イートインあり", "高校生・受験生応援"]) {
    if (c.has(k)) out.push({ t: k });
  }
  return out;
}
const isMust = (e) => e.conditions.includes("予約必須");

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

function evHTML(e) {
  const img = e.image_local || e.image;
  const cs = conds(e);
  return `<article class="ev${img ? " has-img" : ""}" id="e-${esc(e.id)}">
    ${img ? `<div class="ev-img"><img src="${esc(img)}" alt="" loading="lazy" width="960" height="540"></div>` : ""}
    <div class="ev-main">
      <h3>${esc(e.title)}</h3>
      ${e.organizer ? `<p class="org">${esc(e.organizer.name)}</p>` : ""}
      <dl><dt>日時</dt><dd>${esc(when(e))}</dd><dt>場所</dt><dd>${esc(place(e))}</dd></dl>
      ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ""}
      ${e.notes.length ? `<ul class="notes">${e.notes.map((n) => `<li data-from="${esc(n.from)}">${esc(n.text)}</li>`).join("")}</ul>` : ""}
      ${cs.length ? `<p class="conds">${cs.map((c) => (c.must ? `<span class="m">${esc(c.t)}</span>` : esc(c.t))).join("・")}</p>` : ""}
      <p class="src"><a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">元のページ</a></p>
    </div>
  </article>`;
}

/* ---------- タイムテーブル ---------- */

function gridItems(day) {
  const items = [];
  for (const e of EVENTS) {
    const timed = e.sessions.filter((s) => s.day === day && s.start);
    const extra = e.extraSessions.filter((s) => s.day === day);
    for (const s of [...timed, ...extra]) {
      const start = toMin(s.start);
      const end = s.end ? toMin(s.end) : start + 60;
      items.push({ e, start, end, s });
    }
  }
  return items;
}

function alldayItems(day) {
  return EVENTS.filter((e) => {
    if (!e.sessions.some((s) => s.day === day && s.allday)) return false;
    return !(e.replaceAllday && e.extraSessions.some((s) => s.day === day));
  });
}

function renderTime() {
  const day = state.ttDay;
  renderDays($("tt-days"), FEST.days.map((d) => [d.key, d.label]), day, (k) => { state.ttDay = k; renderTime(); });

  const items = gridItems(day);
  let from = toMin(FEST.open), to = toMin(FEST.close);
  for (const it of items) { from = Math.min(from, Math.floor(it.start / 60) * 60); to = Math.max(to, Math.ceil(it.end / 60) * 60); }
  const pxPerMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) / 60;
  const height = (to - from) * pxPerMin;

  // 場所ごとの列
  const cols = new Map();
  for (const it of items) {
    const k = `${String(it.e.floor ?? 99).padStart(2, "0")}|${it.e.room}`;
    if (!cols.has(k)) cols.set(k, { floor: it.e.floor, room: it.e.room, items: [] });
    cols.get(k).items.push(it);
  }
  const colList = [...cols.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja")).map(([, v]) => v);

  let html = `<div class="tt-col axis"><div class="tt-head"></div><div class="tt-body" style="height:${height}px">`;
  for (let m = from; m <= to; m += 60) {
    html += `<span class="hour" style="top:${(m - from) * pxPerMin}px">${m / 60}:00</span>`;
  }
  html += `</div></div>`;

  for (const c of colList) {
    // 重なったら横に並べる
    c.items.sort((a, b) => a.start - b.start || b.end - a.end);
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
      const top = (it.start - from) * pxPerMin;
      const h = Math.max(18, (it.end - it.start) * pxPerMin - 2);
      const short = it.end - it.start < 45;
      const name = it.s.label || it.e.title;
      const sub = it.s.label ? it.e.title : it.s.sub || "";
      const t = `${fmt(it.start)}〜${fmt(it.end)}`;
      const lane = n > 1 ? `left:calc(${(100 / n) * it.lane}% + 3px);right:auto;width:calc(${100 / n}% - 6px);` : "";
      html += `<button type="button" class="blk${short ? " short" : ""}" data-id="${esc(it.e.id)}" data-s="${it.start}" data-e="${it.end}" style="top:${top}px;height:${h}px;${lane}">`
        + `<span class="t">${short ? fmt(it.start) : t}</span><span class="n">${esc(name)}</span>`
        + (!short && sub ? `<span class="s">${esc(sub)}</span>` : "")
        + (!short && isMust(it.e) ? `<span class="m">予約必須</span>` : "")
        + `</button>`;
    }
    html += `</div></div>`;
  }
  const tt = $("tt");
  tt.innerHTML = html;
  tt.dataset.from = from;
  tt.dataset.to = to;
  tt.dataset.ppm = pxPerMin;
  drawNow();

  const rows = alldayItems(day).map((e) => {
    // 一覧には時刻の入った注記の最初の文だけ
    const note = e.notes.find((n) => /\d:\d\d/.test(n.text));
    return `<tr class="link" data-id="${esc(e.id)}"><th>${esc(place(e))}</th><td>${esc(e.title)}${isMust(e) ? `<span class="m">${e.conditions.includes("予約不要") ? "一部予約必須" : "予約必須"}</span>` : ""}${note ? `<span class="note">${esc(note.text.split("。")[0])}</span>` : ""}</td></tr>`;
  });
  $("allday").innerHTML = rows.join("") || `<tr><td class="note">なし</td></tr>`;
}

function fmt(m) { return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; }

function drawNow() {
  const tt = $("tt");
  if (!tt.dataset.from) return;
  tt.querySelectorAll(".nowline").forEach((n) => n.remove());
  tt.querySelectorAll(".blk.now").forEach((n) => n.classList.remove("now"));
  const now = jstNow();
  const from = +tt.dataset.from, to = +tt.dataset.to, ppm = +tt.dataset.ppm;
  if (now.key !== state.ttDay || now.min < from || now.min > to) return;
  for (const body of tt.querySelectorAll(".tt-body")) {
    const line = document.createElement("div");
    line.className = "nowline";
    line.style.top = `${(now.min - from) * ppm}px`;
    body.appendChild(line);
  }
  tt.querySelectorAll(".blk").forEach((b) => { if (+b.dataset.s <= now.min && now.min < +b.dataset.e) b.classList.add("now"); });
}

/* ---------- パンフ ---------- */

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

function renderPamph() {
  renderDays($("pf-days"), [["all", "すべて"], ...FEST.days.map((d) => [d.key, d.label])], state.pfDay, (k) => { state.pfDay = k; renderPamph(); });
  const q = norm(state.q).trim();
  const list = EVENTS.filter((e) => (state.pfDay === "all" || e.sessions.some((s) => s.day === state.pfDay)) && (!q || q.split(/\s+/).every((w) => e.haystack.includes(w))));
  const floors = new Map();
  for (const e of list) {
    const k = e.floor ?? 99;
    if (!floors.has(k)) floors.set(k, []);
    floors.get(k).push(e);
  }
  $("floors").innerHTML = [...floors.entries()].sort((a, b) => a[0] - b[0])
    .map(([f, es]) => `<section class="floor"><h2>${f === 99 ? "その他" : `${f}階`}</h2>${es.map(evHTML).join("")}</section>`).join("");
  $("empty").hidden = list.length > 0;
}

function renderOrgs() {
  $("orgs").innerHTML = ORGS.map((o) => {
    const evs = EVENTS.filter((e) => e.organizer && e.organizer.id === o.id);
    return `<div class="org-item"><h3>${esc(o.name)}</h3>
      ${o.description ? `<p>${esc(o.description.replace("本Webサイト", "学祭ポータル"))}</p>` : ""}
      <p>${evs.map((e) => `<a href="#e-${esc(e.id)}" data-open="${esc(e.id)}">${esc(e.title)}</a>`).join("・")}</p>
      ${o.links.length ? `<p class="links">${o.links.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.service)}</a>`).join("")}</p>` : ""}
    </div>`;
  }).join("");
}

/* ---------- 共通 ---------- */

function renderDays(el, opts, cur, onPick) {
  el.innerHTML = opts.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === cur}" data-k="${esc(k)}">${esc(l)}</button>`).join("");
  el.onclick = (ev) => { const b = ev.target.closest("button"); if (b) onPick(b.dataset.k); };
}

function openDetail(id) {
  const e = BY_ID.get(id);
  if (!e) return;
  $("dlg-body").innerHTML = evHTML(e);
  const d = $("detail");
  if (!d.open) d.showModal();
  d.scrollTop = 0;
}

function route() {
  if ($("detail").open) $("detail").close();
  const tab = location.hash === "#pamph" ? "pamph" : "time";
  $("view-time").hidden = tab !== "time";
  $("view-pamph").hidden = tab !== "pamph";
  document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === tab ? "page" : "false"));
}

async function main() {
  const [fest, extra] = await Promise.all(["data/fest.json", "data/extra.json"].map((u) => fetch(u, { cache: "no-cache" }).then((r) => r.json())));
  FEST = extra.festival;
  ORGS = fest.organizers;
  EVENTS = fest.events.map((e) => {
    const x = extra.events[e.id] || {};
    const notes = x.notes || [];
    return {
      ...e,
      notes,
      extraSessions: x.sessions || [],
      replaceAllday: !!x.replace_allday,
      haystack: norm([e.title, e.organizer?.name, e.description, place(e), e.tags.join(" "), notes.map((n) => n.text).join(" ")].join(" ")),
    };
  });
  BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

  const now = jstNow();
  state.ttDay = FEST.days.some((d) => d.key === now.key) ? now.key : FEST.days[0].key;

  $("site-sub").innerHTML = `${esc(FEST.days.map((d) => d.label).join("・"))} ${esc(FEST.open)}〜${esc(FEST.close)}<br>${esc(FEST.campus)}`;
  const upd = fest.updated_at ? fest.updated_at.replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, (_, m, d, t) => `${+m}/${+d} ${t}`) : "";
  $("foot").innerHTML = `<p>非公式のまとめです。最新の情報は<a href="https://itlfest.com/" target="_blank" rel="noopener">公式サイト</a>でご確認ください。</p>
    <p>企画の情報：<a href="${esc(safeUrl(fest.source))}" target="_blank" rel="noopener">学祭ポータル</a>（C3 | Creative Computing Club）。画像と文章は iTLFest.実行委員会と各団体のものです。時刻の一部はポスターと公式サイトから補いました。</p>
    ${upd ? `<p>データの更新：${esc(upd)}</p>` : ""}`;

  renderInfo();
  renderTime();
  renderPamph();
  renderOrgs();
  route();

  window.addEventListener("hashchange", route);
  $("q").addEventListener("input", (ev) => { state.q = ev.target.value; renderPamph(); });
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest(".blk, tr.link, [data-open]");
    if (!t) return;
    ev.preventDefault();
    openDetail(t.dataset.id || t.dataset.open);
  });
  $("dlg-close").onclick = () => $("detail").close();
  $("detail").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  setInterval(drawNow, 60e3);
}

main().catch((err) => {
  console.error(err);
  document.querySelector("main").innerHTML = `<p class="empty">データを読み込めませんでした。</p>`;
});
