"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u || "") ? u : "#");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();

let FEST, EVENTS, ORGS, BY_ID;
const state = { ttDay: null, pfDay: "all", genre: "all", q: "" };

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
const CHEV = `<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`;
const mustTag = (e) => (mustLabel(e) ? `<span class="tag must">${mustLabel(e)}</span>` : "");

function condText(e) {
  const c = new Set(e.conditions);
  const out = [];
  if (c.has("予約不要") && !c.has("予約必須")) out.push("予約不要");
  if (c.has("完全無料") && !e.tags.includes("飲食") && !e.tags.includes("物販")) out.push("無料");
  for (const k of ["キッズ歓迎", "撮影OK", "途中入退場OK", "キャッシュレス可", "イートインあり", "高校生・受験生応援"]) if (c.has(k)) out.push(k);
  return out.join("／");
}

function when(e) {
  const per = FEST.days
    .map((d) => {
      // 「終日」をポスターの時刻で置き換える企画（軽音）は、そちらを出す
      const ex = e.extraSessions.filter((s) => s.day === d.key);
      const ss = e.replaceAllday && ex.length ? ex : e.sessions.filter((s) => s.day === d.key);
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
    ${mustLabel(e) ? `<p class="must-line">${mustTag(e)}<span class="must-how">予約のしかたは公式の${officialLinks()}でご確認ください</span></p>` : ""}
    <dl><dt>日時</dt><dd>${esc(when(e))}</dd><dt>場所</dt><dd>${esc(place(e))}</dd></dl>
    ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ""}
    ${lineupHTML(e)}
    ${e.notes.length ? `<ul class="notes">${e.notes.map((n) => `<li><span class="from">${esc(n.from)}より</span>${esc(n.text)}</li>`).join("")}</ul>` : ""}
    ${cond ? `<p class="conds">${esc(cond)}</p>` : ""}
    <p class="src"><a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">学祭ポータルで見る</a></p>
  </article>`;
}

// 出演順（軽音など）。演奏中・終わった組・休憩を示す
function officialLinks() {
  return FEST.links.filter((l) => l.label === "X" || l.label === "Instagram")
    .map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("・");
}

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

let dlgPushed = false; // 詳細を開いたときに履歴を 1 つ積んだか（戻るで詳細だけを閉じるため）
function openDetail(id, push = true) {
  const e = BY_ID.get(id);
  if (!e) return;
  // 中身の入れ物は毎回新しく作る。前に開いたときのスクロール位置を持ち越さず、必ず一番上から出る
  // （iPhone の Safari では、開いてから一番上へ戻す命令が遅れて効き、下まで開いて戻るように見えた）
  const box = document.createElement("div");
  box.className = "dlg-scroll";
  box.id = "dlg-scroll";
  box.innerHTML = detailHTML(e);
  $("dlg-scroll").replaceWith(box);
  const d = $("detail");
  if (!d.open) {
    d.showModal();
    if (push) { history.pushState({ dlg: id }, ""); dlgPushed = true; }
  }
}

/* ---------- タイムテーブル ---------- */

// 時刻の決まった枠（学祭ポータルの時刻＋ポスターから補った時刻）
function timedItems(day) {
  const items = [];
  for (const e of EVENTS) {
    const own = e.sessions.filter((s) => s.day === day && s.start);
    const extra = e.extraSessions.filter((s) => s.day === day);
    const seen = new Set();
    for (const s of [...extra, ...own]) {
      const start = toMin(s.start);
      const key = `${s.start}-${s.end || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
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
    </span>${CHEV}
  </button></li>`;
}

function renderNow(items) {
  const now = jstNow();
  const box = $("nowbox");
  const open = toMin(FEST.open), close = toMin(FEST.close);
  if (now.key !== state.ttDay) { box.innerHTML = ""; return; }
  if (now.min >= close) {
    const next = FEST.days[FEST.days.findIndex((d) => d.key === now.key) + 1];
    box.innerHTML = `<section class="nowbox done" aria-label="いま"><h2>本日は終了しました</h2>
      <p class="nb-note">${next ? `あすは ${esc(next.label)} ${esc(FEST.open)}〜${esc(FEST.close)}` : "今年の開催はすべて終わりました"}</p></section>`;
    return;
  }
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
  let html = `<div class="tt-col axis"><div class="tt-body" style="height:${height}px">`;
  let heads = "";
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
    const where = [c.floor ? `${c.floor}階` : "", c.room].filter(Boolean).join(" ");
    heads += `<div class="tt-head">${c.floor ? `<span>${c.floor}階</span>` : ""}<b>${esc(c.room)}</b></div>`;
    html += `<div class="tt-col${c.items.some((it) => it.lineup.length) ? " wide" : ""}" role="group" aria-label="${esc(where)}"><div class="tt-body" style="height:${height}px">`;
    for (const it of c.items) {
      const short = it.end - it.start < 45;
      const label = it.name.replace(/^iTLFest\.\s*/, ""); // 表の中では学祭の名前を省く
      const st = liveState(it, now, state.ttDay);
      const lane = n > 1 ? `left:calc(${(100 / n) * it.lane}% + 4px);right:auto;width:calc(${100 / n}% - 8px);` : "";
      const lu = it.lineup.length && !short;
      const h = Math.max(20, (it.end - it.start) * pxPerMin - 2);
      let inner;
      if (lu) {
        // 出演順は、それぞれの開始時刻の高さに置く（左の目盛りとそろい、枠の下まで使う）。上の題名と重なる分だけ下へ送る
        const tops = [];
        let next = 24;
        for (const b of it.lineup) { const t = Math.max((b.startMin - it.start) * pxPerMin, next); tops.push(t); next = t + 18; }
        inner = `<span class="lu-title">${esc(label)}</span>` + it.lineup.map((b, i) => {
          const bs = now.key !== state.ttDay ? "" : b.endMin <= now.min ? "done" : b.startMin <= now.min ? "on" : "";
          const bottom = i + 1 < tops.length ? tops[i + 1] : h;
          return `<span class="lu ${bs}" style="top:${tops[i]}px;height:${bottom - tops[i]}px"><span class="tnum">${fmt(b.startMin)}</span> ${esc(b.name)}</span>`;
        }).join("");
      } else {
        inner = `<span class="t tnum">${short ? fmt(it.start) : `${fmt(it.start)}〜${fmt(it.end)}`}</span><span class="n">${esc(label)}${short ? "" : mustTag(it.e)}</span>`
          + (!short && it.sub ? `<span class="s">${esc(it.sub)}</span>` : "")
          // 団体名は正式な名前で。折り返すなら「iTLFest.」の後ろで
          + (!short && it.e.organizer ? `<span class="o">${esc(it.e.organizer.name).replace(/^(iTLFest\.)\s*/, "$1<wbr>")}</span>` : "");
      }
      html += `<button type="button" class="blk ${short ? "short" : ""} ${lu ? "has-lu" : ""} ${st}" data-id="${esc(it.e.id)}" style="top:${(it.start - from) * pxPerMin}px;height:${h}px;${lane}">${inner}</button>`;
    }
    html += `</div></div>`;
  }
  $("tt").innerHTML = html;
  $("tt-heads").innerHTML = heads;
  if (now.key === state.ttDay && now.min >= from && now.min <= to) {
    for (const body of $("tt").querySelectorAll(".tt-body")) body.insertAdjacentHTML("beforeend", `<div class="nowline" style="top:${(now.min - from) * pxPerMin}px"></div>`);
  }
}

// 表が画面からはみ出すときだけ「左右にずらせる」と出す。教室名の行の幅と横の位置を表にそろえる
function updateHint() {
  const w = $("tt-wrap");
  $("tt-hint").hidden = w.scrollWidth <= w.clientWidth + 1;
  document.documentElement.style.setProperty("--bar-h", `${document.querySelector(".bar").offsetHeight}px`);
  const heads = $("tt-heads").children;
  $("tt").querySelectorAll(".tt-col:not(.axis)").forEach((c, i) => { if (heads[i]) heads[i].style.width = `${c.getBoundingClientRect().width}px`; });
  syncHeads();
  // 枠に収まらないときは、薄い団体名を省く
  for (const o of $("tt").querySelectorAll(".blk .o")) {
    if (o.getBoundingClientRect().bottom > o.parentElement.getBoundingClientRect().bottom - 4) o.remove();
  }
}
function syncHeads() {
  $("tt-heads").style.transform = `translateX(${-$("tt-wrap").scrollLeft}px)`;
}

function renderTime() {
  const day = state.ttDay;
  renderDays($("tt-days"), FEST.days.map((d) => [d.key, d.label]), day, (k) => { state.ttDay = k; renderTime(); });
  const items = timedItems(day);
  let from = toMin(FEST.open), to = toMin(FEST.close);
  for (const it of items) { from = Math.min(from, Math.floor(it.start / 60) * 60); to = Math.max(to, Math.ceil(it.end / 60) * 60); }

  renderNow(items);
  const now = jstNow();
  renderGrid(items, from, to);
  updateHint();

  $("allday-head").innerHTML = `終日<small>${esc(FEST.open)}〜${esc(FEST.close)}</small>`;
  renderAllday(day);
}

// 両日やるのか、片方の日だけなのかの印
function dayTag(e) {
  const days = FEST.days.filter((d) => e.sessions.some((s) => s.day === d.key));
  if (days.length === FEST.days.length) return `<span class="tag both">両日</span>`;
  return days.map((d) => `<span class="tag only">${esc(d.label.replace(/（.*）/, ""))}のみ</span>`).join("");
}

// 終日の企画：ビルの案内板のように、左に大きく階、右にその階の企画と教室番号
function renderAllday(day) {
  const full = `${FEST.open}〜${FEST.close}`;
  const floors = new Map();
  for (const e of alldayItems(day)) {
    const k = e.floor ?? 99;
    if (!floors.has(k)) floors.set(k, []);
    floors.get(k).push(e);
  }
  // 案内板と同じく上の階ほど上に（階が分からないものは最後）
  $("allday").innerHTML = [...floors.keys()].sort((a, b) => (a === 99) - (b === 99) || b - a).map((f) => `<div class="dir-floor">
    <div class="dir-f tnum" aria-hidden="true">${f === 99 ? "他" : `${f}F`}</div>
    <ul class="dir-list" aria-label="${f === 99 ? "その他" : `${f}階`}">${floors.get(f).map((e) => {
      // 時刻の入った注記を 1 文だけ（終日と同じ「10:00〜17:00」は書かない）
      const note = e.notes.flatMap((n) => n.text.split("。")).find((t) => /\d:\d\d/.test(t) && t.trim() !== full);
      const num = /^(\d+)教室$/.exec(e.room); // 「401教室」は右に番号だけ。それ以外の場所は名前の下に
      return `<li><button type="button" class="dir-row" data-id="${esc(e.id)}">
        <span class="r-main">
          <span class="r-title">${esc(e.title)}${dayTag(e)}${mustTag(e)}</span>
          ${num ? "" : `<span class="r-meta">${esc(e.room)}</span>`}
          ${note ? `<span class="r-meta">${esc(note.trim())}</span>` : ""}
        </span>
        ${num ? `<span class="dir-room tnum">${esc(num[1])}</span>` : ""}${CHEV}
      </button></li>`;
    }).join("")}</ul>
  </div>`).join("") || `<p class="empty">なし</p>`;
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
    ${img ? `<span class="r-thumb"><img src="${esc(img)}" alt="" loading="lazy" width="104" height="59"></span>` : ""}${CHEV}
  </button></li>`;
}

// ジャンルで絞る（学祭ポータルのタグから。どの企画もどれかに入る）
const GENRES = [
  ["飲食", ["飲食"]],
  ["ステージ", ["ステージ・公演"]],
  ["講演", ["講演", "学術・研究発表"]],
  ["アトラクション", ["アトラクション", "大会・コンテスト"]],
  ["体験", ["体験・ワークショップ"]],
  ["展示", ["展示", "物販"]],
];
const inGenre = (e, g) => g === "all" || GENRES.find(([name]) => name === g)[1].some((t) => e.tags.includes(t));

function renderPamph() {
  renderDays($("pf-days"), [["all", "すべて"], ...FEST.days.map((d) => [d.key, d.label])], state.pfDay, (k) => { state.pfDay = k; renderPamph(); });
  renderDays($("genre"), [["all", "すべて"], ...GENRES.map(([name]) => [name, name])], state.genre, (k) => { state.genre = k; renderPamph(); });
  const words = norm(state.q).trim().split(/\s+/).filter(Boolean);
  const list = EVENTS.filter((e) => (state.pfDay === "all" || e.sessions.some((s) => s.day === state.pfDay)) && inGenre(e, state.genre) && words.every((w) => e.haystack.includes(w)));
  const floors = new Map();
  for (const e of list) {
    const k = e.floor ?? 99;
    if (!floors.has(k)) floors.set(k, []);
    floors.get(k).push(e);
  }
  const keys = [...floors.keys()].sort((a, b) => a - b);
  const name = (f) => (f === 99 ? "その他" : `${f}階`);
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
    ["予約", FEST.reserve_note],
  ];
  $("info").innerHTML = rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")
    + `<tr><th>行き方</th><td><a href="${esc(safeUrl(FEST.access_url))}" target="_blank" rel="noopener">公式サイトの「アクセス」</a></td></tr>`
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

let curTab = null;
function route() {
  if ($("detail").open) { dlgPushed = false; $("detail").close(); }
  const h = location.hash;
  const tab = h === "#pamph" || h.startsWith("#e-") ? "pamph" : "time";
  // タブを切り替えたら一番上から（前のタブの途中の位置のまま開かない）
  if (curTab && curTab !== tab) window.scrollTo({ top: 0, behavior: "instant" });
  curTab = tab;
  $("view-time").hidden = tab !== "time";
  $("view-pamph").hidden = tab !== "pamph";
  if (tab === "time") renderTime();
  document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === tab ? "page" : "false"));
  // #e-企画 で直接開ける（共有用）
  if (h.startsWith("#e-")) {
    let id = "";
    try { id = decodeURIComponent(h.slice(3)); } catch { /* 壊れたリンクは開かない */ }
    openDetail(id, false);
  }
}

async function getJSON(u) {
  try {
    const r = await fetch(u, { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch {
    return (await fetch(u, { cache: "force-cache" })).json();
  }
}

async function main() {
  const [fest, extra] = await Promise.all(["data/fest.json", "data/extra.json"].map(getJSON));
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
    ${upd ? `<p>学祭ポータルの内容が最後に変わったのは ${esc(upd)} です（1 時間ごとに確かめています）。</p>` : ""}
    ${sourcesHTML()}`;

  renderInfo();
  renderTime();
  renderPamph();
  renderOrgs();
  route();

  window.addEventListener("hashchange", route);
  window.addEventListener("resize", updateHint);
  $("tt-wrap").addEventListener("scroll", syncHeads, { passive: true });
  $("q").addEventListener("input", (ev) => { state.q = ev.target.value; renderPamph(); });
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-id]");
    if (!t || t.closest("dialog")) return;
    ev.preventDefault();
    openDetail(t.dataset.id);
  });
  $("dlg-close").onclick = () => $("detail").close();
  $("detail").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  $("detail").addEventListener("close", () => {
    if (dlgPushed) { dlgPushed = false; history.back(); return; } // 閉じるボタン：積んだ履歴を戻す
    if (!$("detail").open && location.hash.startsWith("#e-")) history.replaceState(null, "", "#pamph");
  });
  window.addEventListener("popstate", () => { if (dlgPushed && $("detail").open) { dlgPushed = false; $("detail").close(); } });
  setInterval(() => {
    if ($("view-time").hidden) return;
    // 「いま」の箱の高さが変わっても、その下を読んでいる人の位置がずれないように
    const box = $("nowbox"), before = box.offsetHeight, above = box.getBoundingClientRect().bottom < 80;
    renderTime();
    if (above) window.scrollBy(0, box.offsetHeight - before);
  }, 60e3);
}

main().catch((err) => {
  console.error(err);
  document.querySelector("main").innerHTML = `<p class="empty">データを読み込めませんでした。<button type="button" class="retry" onclick="location.reload()">もう一度読み込む</button></p>`;
});
