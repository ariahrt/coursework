"use strict";
// To-do, Calendar and Inbox pages. Loaded after app.js; starts the app at the bottom.

// ---------- Canvas: calendar and inbox ----------
Object.assign(Canvas, {
  async loadRange(start, end) {
    const codes = [...S.courses.map(c => `course_${c.id}`), `user_${S.user.id}`];
    const range = { start_date: start.toISOString(), end_date: end.toISOString(), per_page: 100 };
    // Canvas caps how many calendars one request can ask for, so ask in batches of 10.
    const batches = [];
    for (let i = 0; i < codes.length; i += 10) batches.push(codes.slice(i, i + 10));
    const [planner, ...events] = await Promise.all([
      this.get("planner/items", range, true),
      ...batches.map(b => this.get("calendar_events", { ...range, type: "event", "context_codes[]": b }, true).catch(() => [])),
    ]);
    return {
      planner: this.mapPlanner(planner),
      events: events.flat().map(e => ({
        id: String(e.id),
        courseId: /^course_/.test(e.context_code || "") ? e.context_code.slice(7) : null,
        title: e.title || "Event",
        start: new Date(e.start_at),
        end: e.end_at ? new Date(e.end_at) : null,
        allDay: !!e.all_day,
        location: e.location_name || "",
        desc: htmlToText(e.description).slice(0, 400),
        url: safeUrl(e.html_url),
      })),
    };
  },

  async unreadCount() {
    return +(await this.get("conversations/unread_count")).unread_count || 0;
  },

  mapConvo(c) {
    const me = S.user.id;
    const names = Object.fromEntries((c.participants || []).map(p => [String(p.id), p.name]));
    return {
      id: String(c.id),
      subject: c.subject || "(No subject)",
      preview: c.last_message || "",
      when: new Date(c.last_message_at || c.last_authored_message_at || Date.now()),
      unread: c.workflow_state === "unread",
      people: (c.participants || []).filter(p => String(p.id) !== me).map(p => p.name),
      courseName: c.context_name || "",
      messages: c.messages && c.messages.map(m => ({
        id: String(m.id),
        author: names[String(m.author_id)] || "Someone",
        mine: String(m.author_id) === me,
        when: new Date(m.created_at),
        body: m.body || "",
        files: (m.attachments || []).map(f => ({ name: f.display_name, size: f.size, url: safeUrl(f.url) })),
      })).sort((a, b) => a.when - b.when),
    };
  },

  async loadInbox(scope, courseId) {
    const list = await this.get("conversations", { scope, per_page: 40, ...(courseId ? { "filter[]": `course_${courseId}` } : {}) });
    return list.map(c => this.mapConvo(c));
  },

  // Opening a conversation marks it read in Canvas too, same as Canvas does.
  async loadConversation(id) {
    return this.mapConvo(await this.get(`conversations/${id}`));
  },

  async reply(id, body) {
    await this.post(`conversations/${id}/add_message`, { body });
    return this.loadConversation(id);
  },

  async send({ courseId, to, subject, body }) {
    const made = await this.post("conversations", {
      "recipients[]": to.map(r => r.id), subject, body,
      context_code: `course_${courseId}`, group_conversation: true,
    });
    return Array.isArray(made) && made[0] ? String(made[0].id) : null;
  },

  async searchRecipients(courseId, q) {
    const found = await this.get("search/recipients", { search: q, context: `course_${courseId}`, "types[]": "user", per_page: 8 });
    return found.map(r => ({ id: String(r.id), name: r.name }));
  },
});

// ---------- Shared ----------
const typeTile = (kind, c) => `<span class="type" style="--c:${c ? cColor(c) : "var(--muted)"}">${ICON[kind] || ICON.assignment}</span>`;
const linkTo = (href, cls, inner) => !href ? `<span class="${cls}">${inner}</span>`
  : href.startsWith("#") ? `<a class="${cls}" href="${esc(href)}">${inner}</a>`
  : `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
const plannerHref = p => byId[p.courseId] && p.assignmentId ? aLink(p.courseId, p.assignmentId) : p.url;
const timeOf = d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayLabel = d => sameDay(d, now) ? "Today" : sameDay(d, new Date(now.getTime() + DAY)) ? "Tomorrow" : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

let unread = 0;
async function refreshUnread() {
  try { unread = await source().unreadCount(); } catch { unread = 0; }
  const b = $("inbox-badge");
  b.textContent = unread > 99 ? "99+" : unread;
  b.hidden = !unread;
}

function handleLoadError(e, targetId, hash) {
  if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
  if (location.hash === hash && $(targetId)) $(targetId).innerHTML = errorHTML(e);
}

// ---------- To-do ----------
const todo = { course: "", hideDone: false };

function todoRow(p, showDate = false) {
  const c = byId[p.courseId], d = isDone(p), urgent = !d && (p.missing || (p.due > now && p.due - now < DAY));
  return `<li class="trow ${d ? "done" : ""}" data-key="${esc(p.key)}">
    <button class="check" aria-label="${d ? "Mark not done" : "Mark done"}">${d ? ICON.check : ""}</button>
    ${typeTile(p.kind, c)}
    <div class="tmain">${linkTo(plannerHref(p), "t", esc(p.title))}
      <div class="meta">${c ? `<span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))}` : ""}${p.pts ? `<span>${num(p.pts)} pts</span>` : ""}${p.missing && !d ? '<span class="pill late">Missing</span>' : d && p.submitted ? '<span class="pill ok">Submitted</span>' : ""}</div>
    </div>
    <span class="when ${urgent ? "soon" : ""}">${showDate ? fmtWhen(p.due) : timeOf(p.due)}</span>
  </li>`;
}

function renderTodo() {
  const sod = startOfDay(now);
  const mine = S.planner.filter(p => !todo.course || p.courseId === todo.course);
  const missing = mine.filter(p => p.missing && p.due < sod && !isDone(p)).sort(byDue);
  const upcoming = mine.filter(p => p.due >= sod && (!todo.hideDone || !isDone(p))).sort(byDue);
  const days = [];
  for (const p of upcoming) {
    const label = dayLabel(p.due);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1).items.push(p);
  }
  const left = mine.filter(p => p.due >= sod && !isDone(p)).length;

  // Side panels
  const week = S.planner.filter(p => p.due >= sod && p.due - sod < 7 * DAY);
  const weekDone = week.filter(isDone).length;
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sod.getTime() + i * DAY), items = week.filter(p => sameDay(p.due, d));
    return { d, total: items.length, done: items.filter(isDone).length };
  });
  const tallest = Math.max(1, ...perDay.map(x => x.total));
  const big = S.planner.filter(p => !isDone(p) && p.due >= now && p.pts).sort((a, b) => b.pts - a.pts || a.due - b.due).slice(0, 3);
  const perCourse = S.courses.map(c => ({ c, open: S.planner.filter(p => p.courseId === c.id && p.due >= sod && !isDone(p)).length }));
  const mostOpen = Math.max(1, ...perCourse.map(x => x.open));

  $("view").innerHTML = `
    <header class="hello"><div><h1>To-do</h1><p>${left ? `${left} thing${left > 1 ? "s" : ""} left over the next four weeks${todo.course ? ` in ${esc(cName(byId[todo.course]))}` : ""}.` : "You're all caught up."}</p></div></header>
    <div class="grid">
      <section class="card">
        <div class="filters">
          <button class="fchip ${!todo.course ? "on" : ""}" data-todo-course="">All</button>
          ${S.courses.map(c => `<button class="fchip ${todo.course === c.id ? "on" : ""}" data-todo-course="${esc(c.id)}" style="--c:${cColor(c)}"><span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))}</button>`).join("")}
          <label class="toggle"><input type="checkbox" id="todo-hide" ${todo.hideDone ? "checked" : ""}> Hide done</label>
        </div>
        ${missing.length ? `<div class="sub-h warn">Missing · ${missing.length}</div><ul class="due tlist">${missing.map(p => todoRow(p, true)).join("")}</ul>` : ""}
        ${days.map(d => `<div class="sub-h">${esc(d.label)}</div><ul class="due tlist">${d.items.map(p => todoRow(p)).join("")}</ul>`).join("")}
        ${!missing.length && !days.length ? `<p class="empty" style="padding-top:12px">${todo.hideDone ? "Everything here is done." : "Nothing on your list."}</p>` : ""}
      </section>

      <div class="stack">
        <section class="card"><div class="card-h"><h2>This week</h2><span class="hint">${weekDone} of ${week.length} done</span></div>
          <div class="gbody">
            <div class="bar big"><i style="width:${week.length ? weekDone / week.length * 100 : 0}%"></i></div>
            <div class="minibars">${perDay.map(x => `<div class="mb ${sameDay(x.d, now) ? "today" : ""}" title="${x.done} of ${x.total} done">
              <div class="mb-col"><i class="all" style="height:${x.total / tallest * 100}%"></i><i class="fin" style="height:${x.done / tallest * 100}%"></i></div>
              <span>${x.d.toLocaleDateString([], { weekday: "narrow" })}</span></div>`).join("")}</div>
          </div></section>

        ${big.length ? `<section class="card"><div class="card-h"><h2>Big ones coming</h2><span class="hint">by points</span></div>
          <ul class="rows">${big.map(p => `<li>${rowLink(plannerHref(p), `${typeTile(p.kind, byId[p.courseId])}
            <div><div class="rt">${esc(p.title)}</div><div class="meta">${byId[p.courseId] ? esc(cName(byId[p.courseId])) + " · " : ""}${relDay(p.due)}</div></div>
            <span class="score">${num(p.pts)}<small>pts</small></span>`)}</li>`).join("")}</ul></section>` : ""}

        <section class="card"><div class="card-h"><h2>By course</h2><span class="hint">still to do</span></div>
          <div class="weights">${perCourse.map(({ c, open }) => `<button class="bycourse" data-todo-course="${esc(c.id)}" style="--c:${cColor(c)}">
            <div class="w-top"><b>${esc(cName(c))}</b><span>${open}</span></div><div class="bar"><i style="width:${open / mostOpen * 100}%"></i></div></button>`).join("")}</div></section>

        <section class="card"><div class="card-h"><h2>Inbox</h2><a href="#/inbox">Open →</a></div><div id="todo-inbox">${loadingHTML("Checking messages…")}</div></section>
      </div>
    </div>
    <p class="footnote">Checkmarks are saved in this browser only. Items you've submitted are checked off automatically.</p>`;

  const hash = location.hash;
  getInbox("unread", "").then(list => {
    if (location.hash !== hash || !$("todo-inbox")) return;
    $("todo-inbox").innerHTML = list.length
      ? `<ul class="rows">${list.slice(0, 3).map(cv => `<li>${rowLink(`#/inbox/${cv.id}`, `<span class="type">${ICON.discussion}</span>
          <div><div class="rt">${esc(cv.subject)}</div><div class="meta">${esc(cv.people.slice(0, 2).join(", "))} · ${ago(cv.when)}</div></div><span class="unread-dot"></span>`)}</li>`).join("")}</ul>`
      : `<p class="empty">No unread messages.</p>`;
  }).catch(e => handleLoadError(e, "todo-inbox", hash));
}

// ---------- Calendar ----------
const cal = { month: null, selected: null, start: null, data: null };
const ranges = {};   // month key -> promise of { planner, events }

function monthRange(m) {
  const start = new Date(m.getFullYear(), m.getMonth(), 1);
  start.setDate(1 - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  return [start, end];
}
const getRange = m => ranges[`${m.getFullYear()}-${m.getMonth()}`] ??= source().loadRange(...monthRange(m))
  .catch(e => { delete ranges[`${m.getFullYear()}-${m.getMonth()}`]; throw e; });

function entriesOn(day) {
  const hidden = new Set(prefs.calHidden), show = id => !id || !hidden.has(id);
  const dayEnd = new Date(day.getTime() + DAY);
  const dues = cal.data.planner.filter(p => sameDay(p.due, day) && show(p.courseId))
    .map(p => ({ type: "due", p, courseId: p.courseId, title: p.title, time: p.due, allDay: false, done: isDone(p) }));
  const evs = cal.data.events.filter(e => show(e.courseId) && e.start < dayEnd && (e.end && e.end > e.start ? e.end > day : e.start >= day))
    .map(e => ({ type: "event", e, courseId: e.courseId, title: e.title, time: e.start, allDay: e.allDay, done: false }));
  return [...evs, ...dues].sort((a, b) => (b.allDay - a.allDay) || (a.time - b.time));
}
const entryColor = en => byId[en.courseId] ? cColor(byId[en.courseId]) : "var(--accent)";

async function renderCalendar() {
  cal.month ??= new Date(now.getFullYear(), now.getMonth(), 1);
  cal.selected ??= startOfDay(now);
  const m = cal.month, hash = location.hash;
  $("view").innerHTML = `
    <header class="hello cal-head">
      <div><h1>${m.toLocaleDateString([], { month: "long", year: "numeric" })}</h1><p id="cal-sub">&nbsp;</p></div>
      <div class="cal-nav">
        <button class="btn" data-cal="prev" aria-label="Previous month">‹</button>
        <button class="btn" data-cal="today">Today</button>
        <button class="btn" data-cal="next" aria-label="Next month">›</button>
      </div>
    </header>
    <div class="grid cal-grid">
      <section class="card cal-card" id="cal-month">${loadingHTML("Loading calendar…")}</section>
      <div class="stack" id="cal-side"></div>
    </div>`;
  let data;
  try { data = await getRange(m); }
  catch (e) { return handleLoadError(e, "cal-month", hash); }
  if (location.hash !== hash || cal.month !== m) return;
  cal.data = data;
  [cal.start] = monthRange(m);
  drawMonth();
  drawCalSide();
}

function drawMonth() {
  const m = cal.month, cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(cal.start); d.setDate(cal.start.getDate() + i);
    const list = entriesOn(d);
    cells.push(`<button class="cday ${d.getMonth() !== m.getMonth() ? "out" : ""} ${sameDay(d, now) ? "today" : ""} ${sameDay(d, cal.selected) ? "sel" : ""}" data-day="${i}" aria-label="${d.toDateString()}, ${list.length} item${list.length === 1 ? "" : "s"}">
      <span class="cnum">${d.getDate()}</span>
      <span class="chips">${list.slice(0, 3).map(en => `<span class="chip ${en.done ? "done" : ""} ${en.type}" style="--c:${entryColor(en)}">${esc(en.title)}</span>`).join("")}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ""}</span>
      <span class="cdots">${list.slice(0, 4).map(en => `<i style="background:${entryColor(en)}"></i>`).join("")}</span>
    </button>`);
  }
  const inMonth = x => x.getMonth() === m.getMonth();
  const dues = cal.data.planner.filter(p => inMonth(p.due)).length, evs = cal.data.events.filter(e => inMonth(e.start)).length;
  $("cal-sub").textContent = `${dues} due date${dues === 1 ? "" : "s"} and ${evs} event${evs === 1 ? "" : "s"} this month`;
  $("cal-month").innerHTML = `<div class="cweek">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<span>${d}</span>`).join("")}</div><div class="cgrid">${cells.join("")}</div>`;
}

function drawCalSide() {
  const day = cal.selected, list = entriesOn(day);
  const hidden = new Set(prefs.calHidden);
  const entryRow = en => {
    if (en.type === "due") {
      const p = en.p, c = byId[p.courseId];
      return `<li>${rowLink(plannerHref(p), `${typeTile(p.kind, c)}
        <div><div class="rt">${esc(p.title)}</div><div class="meta">${c ? esc(cName(c)) + " · " : ""}Due ${timeOf(p.due)}${p.pts ? ` · ${num(p.pts)} pts` : ""} ${en.done ? '<span class="pill ok">Done</span>' : p.missing ? '<span class="pill late">Missing</span>' : ""}</div></div><span></span>`)}</li>`;
    }
    const e = en.e, c = byId[e.courseId];
    const when = e.allDay ? "All day" : `${timeOf(e.start)}${e.end && e.end > e.start ? `–${timeOf(e.end)}` : ""}`;
    return `<li>${rowLink(e.url, `<span class="type" style="--c:${entryColor(en)}">${ICON.page}</span>
      <div><div class="rt">${esc(e.title)}</div><div class="meta">${when}${c ? ` · ${esc(cName(c))}` : ""}${e.location ? ` · ${esc(e.location)}` : ""}</div>${e.desc ? `<p class="ev-desc">${esc(e.desc)}</p>` : ""}</div><span></span>`)}</li>`;
  };
  $("cal-side").innerHTML = `
    <section class="card"><div class="card-h"><h2>${esc(dayLabel(day))}</h2><span class="hint">${list.length} item${list.length === 1 ? "" : "s"}</span></div>
      ${list.length ? `<ul class="rows">${list.map(entryRow).join("")}</ul>` : `<p class="empty">Nothing on this day.</p>`}</section>
    <section class="card"><div class="card-h"><h2>Show</h2></div>
      <div class="cal-filter">${S.courses.map(c => `<label class="toggle" style="--c:${cColor(c)}"><input type="checkbox" data-calcourse="${esc(c.id)}" ${hidden.has(c.id) ? "" : "checked"}><span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))}</label>`).join("")}</div></section>`;
}

// ---------- Inbox ----------
const box = { scope: "inbox", course: "", lists: {}, convos: {}, compose: null, results: [] };
const getInbox = (scope, course) => box.lists[`${scope}|${course}`] ??= source().loadInbox(scope, course)
  .catch(e => { delete box.lists[`${scope}|${course}`]; throw e; });
const getConvo = id => box.convos[id] ??= source().loadConversation(id)
  .catch(e => { delete box.convos[id]; throw e; });
const SCOPES = [["inbox", "Inbox"], ["unread", "Unread"], ["sent", "Sent"]];

async function renderInbox(id) {
  const hash = location.hash, mode = id === "new" ? "new" : id ? "thread" : "list";
  $("view").innerHTML = `
    <header class="hello"><div><h1>Inbox</h1><p>${unread ? `${unread} unread message${unread > 1 ? "s" : ""}.` : "All caught up."}</p></div>
      <a class="btn primary" href="#/inbox/new">New message</a></header>
    <div class="mail ${mode === "list" ? "" : "open"}">
      <section class="card mail-list">
        <div class="mail-tools">
          <div class="seg" style="grid-template-columns:repeat(3,1fr)">${SCOPES.map(([k, l]) => `<button data-scope="${k}" class="${box.scope === k ? "on" : ""}">${l}</button>`).join("")}</div>
          <select class="area sel" id="mail-course" aria-label="Filter by course"><option value="">All courses</option>${S.courses.map(c => `<option value="${esc(c.id)}" ${box.course === c.id ? "selected" : ""}>${esc(cName(c))}</option>`).join("")}</select>
        </div>
        <div id="mail-items">${loadingHTML("Loading messages…")}</div>
      </section>
      <section class="card mail-read" id="mail-read">${mode === "list" ? `<div class="mail-empty">${ICON.discussion}<p>Pick a conversation to read it.</p></div>` : mode === "new" ? "" : loadingHTML("Opening…")}</section>
    </div>`;
  drawMailList(id);
  if (mode === "new") return drawCompose();
  if (mode === "thread") {
    try {
      const cv = await getConvo(id);
      if (location.hash !== hash) return;
      $("mail-read").innerHTML = threadHTML(cv);
      const msgs = document.querySelector(".msgs");
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      markRead(id);
    } catch (e) { handleLoadError(e, "mail-read", hash); }
  }
}

async function drawMailList(openId) {
  const hash = location.hash;
  try {
    const list = await getInbox(box.scope, box.course);
    if (location.hash !== hash || !$("mail-items")) return;
    $("mail-items").innerHTML = list.length ? `<ul class="convos">${list.map(cv => `<li><a href="#/inbox/${esc(cv.id)}" class="convo ${cv.unread ? "unread" : ""} ${cv.id === openId ? "on" : ""}" data-convo="${esc(cv.id)}">
        <div class="convo-top"><b>${esc(cv.people.slice(0, 3).join(", ") || "Just you")}${cv.people.length > 3 ? ` +${cv.people.length - 3}` : ""}</b><span class="meta">${fmtWhen(cv.when)}</span></div>
        <div class="convo-subj">${cv.unread ? '<span class="unread-dot"></span>' : ""}${esc(cv.subject)}</div>
        <div class="convo-prev">${esc(cv.preview)}</div>
        ${cv.courseName ? `<div class="meta">${esc(cv.courseName)}</div>` : ""}
      </a></li>`).join("")}</ul>` : `<p class="empty" style="padding-top:12px">${box.scope === "unread" ? "No unread messages." : "No messages here."}</p>`;
  } catch (e) { handleLoadError(e, "mail-items", hash); }
}

function markRead(id) {
  let changed = false;
  for (const p of Object.values(box.lists)) p.then(list => list.forEach(cv => { if (cv.id === id && cv.unread) { cv.unread = false; changed = true; } }));
  // Canvas marked it read when we opened it; bring the badge and list in line.
  setTimeout(() => {
    if (!changed) return;
    delete box.lists["unread|"]; delete box.lists[`unread|${box.course}`];
    document.querySelector(`[data-convo="${CSS.escape(id)}"]`)?.classList.remove("unread");
    document.querySelector(`[data-convo="${CSS.escape(id)}"] .unread-dot`)?.remove();
    refreshUnread();
  }, 0);
}

function threadHTML(cv) {
  const draft = store.get(`draft:msg:${cv.id}`) || "";
  return `
    <div class="thread-h">
      <a href="#/inbox" class="back mail-back">← All messages</a>
      <h2>${esc(cv.subject)}</h2>
      <div class="meta">${cv.courseName ? `${esc(cv.courseName)} · ` : ""}with ${esc(cv.people.join(", ") || "just you")}</div>
    </div>
    <div class="msgs">${(cv.messages || []).map(m => `<article class="msg ${m.mine ? "mine" : ""}">
      <div class="meta"><b>${esc(m.mine ? "You" : m.author)}</b> · ${fmtFull(m.when)}</div>
      <div class="bubble">${esc(m.body)}</div>
      ${m.files.length ? `<ul class="rows tight">${m.files.map(fileRow).join("")}</ul>` : ""}
    </article>`).join("")}</div>
    <div class="reply">
      <textarea class="area" id="msg-text" rows="3" placeholder="Write a reply…" data-convo-id="${esc(cv.id)}">${esc(draft)}</textarea>
      <p class="login-err" id="msg-err" role="alert"></p>
      <div class="reply-actions"><span class="meta">Goes to ${esc(cv.people.join(", ") || "you")}</span><button class="btn primary" data-action="send-reply">Send</button></div>
    </div>`;
}

function drawCompose() {
  const d = box.compose ??= { course: todo.course || "", to: [], subject: "", body: "" };
  $("mail-read").innerHTML = `
    <div class="thread-h"><a href="#/inbox" class="back mail-back">← All messages</a><h2>New message</h2></div>
    <div class="compose">
      <div class="field"><label for="c-course">Course</label>
        <select class="area sel" id="c-course"><option value="">Choose a course…</option>${S.courses.map(c => `<option value="${esc(c.id)}" ${d.course === c.id ? "selected" : ""}>${esc(cName(c))}</option>`).join("")}</select></div>
      <div class="field"><label for="to-search">To</label>
        <div class="to-box">
          ${d.to.map((r, i) => `<span class="rcpt">${esc(r.name)}<button data-rm-rcpt="${i}" aria-label="Remove ${esc(r.name)}">✕</button></span>`).join("")}
          <input type="text" id="to-search" placeholder="${d.course ? "Type a name…" : "Pick a course first"}" ${d.course ? "" : "disabled"} autocomplete="off">
        </div>
        <div class="to-results" id="to-results"></div>
        ${d.course && !d.to.some(r => r.id === `course_${d.course}_teachers`) ? `<button class="link" data-add-teachers>Add all instructors</button>` : ""}
      </div>
      <div class="field"><label for="c-subject">Subject</label><input type="text" class="area" id="c-subject" maxlength="200" value="${esc(d.subject)}"></div>
      <div class="field"><label for="c-body">Message</label><textarea class="area" id="c-body" rows="8">${esc(d.body)}</textarea></div>
      <p class="login-err" id="msg-err" role="alert"></p>
      <button class="btn primary" data-action="send-new">Send</button>
    </div>`;
  drawResults();
}

function drawResults() {
  const el = $("to-results");
  if (!el) return;
  const have = new Set(box.compose.to.map(r => r.id));
  const list = box.results.filter(r => !have.has(r.id));
  el.innerHTML = list.map(r => `<button data-add-rcpt="${esc(r.id)}" data-name="${esc(r.name)}">${esc(r.name)}</button>`).join("");
  el.hidden = !list.length;
}

let searchTimer = 0;
function searchPeople(q) {
  clearTimeout(searchTimer);
  const course = box.compose.course;
  if (!q.trim() || !course) { box.results = []; return drawResults(); }
  searchTimer = setTimeout(async () => {
    try { box.results = await source().searchRecipients(course, q.trim()); }
    catch (e) { if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again."); box.results = []; }
    drawResults();
  }, 250);
}

async function sendReply() {
  const t = $("msg-text"), id = t.dataset.convoId, body = t.value.trim();
  if (!body) return ($("msg-err").textContent = "Write something first.");
  const cv = await getConvo(id);
  const ok = await askConfirm({
    title: "Send this reply?",
    html: `<p>It goes to <b>${esc(cv.people.join(", ") || "you")}</b>.</p><blockquote class="preview">${esc(body.slice(0, 400))}${body.length > 400 ? "…" : ""}</blockquote>`,
    yes: "Send",
  });
  if (!ok) return;
  const btn = document.querySelector('[data-action="send-reply"]');
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const updated = await source().reply(id, body);
    box.convos[id] = Promise.resolve(updated);
    for (const k in box.lists) delete box.lists[k];
    store.del(`draft:msg:${id}`);
    toast("Message sent");
    route();
  } catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
    btn.disabled = false; btn.textContent = "Send";
    $("msg-err").textContent = `Couldn't send: ${e.detail || (e.status === "network" ? "the connection dropped" : `Canvas returned ${e.status}`)}. Nothing was sent.`;
  }
}

async function sendNew() {
  const d = box.compose, err = msg => ($("msg-err").textContent = msg);
  d.subject = $("c-subject").value.trim(); d.body = $("c-body").value.trim();
  if (!d.course) return err("Choose a course.");
  if (!d.to.length) return err("Add at least one person.");
  if (!d.body) return err("Write a message first.");
  const ok = await askConfirm({
    title: "Send this message?",
    html: `<p>To <b>${esc(d.to.map(r => r.name).join(", "))}</b> in ${esc(cName(byId[d.course]))}.</p>${d.subject ? `<p class="meta">${esc(d.subject)}</p>` : ""}<blockquote class="preview">${esc(d.body.slice(0, 400))}${d.body.length > 400 ? "…" : ""}</blockquote>`,
    yes: "Send",
  });
  if (!ok) return;
  const btn = document.querySelector('[data-action="send-new"]');
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const newId = await source().send({ courseId: d.course, to: d.to, subject: d.subject, body: d.body });
    box.compose = null; box.results = [];
    for (const k in box.lists) delete box.lists[k];
    toast("Message sent");
    if (newId) { delete box.convos[newId]; location.hash = `#/inbox/${newId}`; }
    else { box.scope = "sent"; location.hash = "#/inbox"; }
  } catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
    btn.disabled = false; btn.textContent = "Send";
    err(`Couldn't send: ${e.detail || (e.status === "network" ? "the connection dropped" : `Canvas returned ${e.status}`)}. Nothing was sent.`);
  }
}

// ---------- Events for these pages ----------
$("view").addEventListener("click", e => {
  const t = e.target;
  const ac = t.closest("[data-ann-course]");
  if (ac) { annState.course = ac.dataset.annCourse; return renderAnnouncements(); }
  const tc = t.closest("[data-todo-course]");
  if (tc) { todo.course = todo.course === tc.dataset.todoCourse ? "" : tc.dataset.todoCourse; return renderTodo(); }

  const nav = t.closest("[data-cal]");
  if (nav) {
    const m = cal.month, step = nav.dataset.cal;
    cal.month = step === "today" ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(m.getFullYear(), m.getMonth() + (step === "next" ? 1 : -1), 1);
    if (step === "today") cal.selected = startOfDay(now);
    return renderCalendar();
  }
  const day = t.closest("[data-day]");
  if (day && cal.start) {
    const d = new Date(cal.start); d.setDate(cal.start.getDate() + +day.dataset.day);
    cal.selected = d;
    if (d.getMonth() !== cal.month.getMonth()) { cal.month = new Date(d.getFullYear(), d.getMonth(), 1); return renderCalendar(); }
    drawMonth(); drawCalSide();
    if (matchMedia("(max-width: 960px)").matches) $("cal-side").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const sc = t.closest("[data-scope]");
  if (sc) { box.scope = sc.dataset.scope; return renderInbox(location.hash.split("/")[2]); }
  if (t.closest('[data-action="send-reply"]')) return sendReply();
  if (t.closest('[data-action="send-new"]')) return sendNew();
  const add = t.closest("[data-add-rcpt]");
  if (add) { box.compose.to.push({ id: add.dataset.addRcpt, name: add.dataset.name }); box.results = []; drawCompose(); $("to-search")?.focus(); return; }
  if (t.closest("[data-add-teachers]")) { box.compose.to.push({ id: `course_${box.compose.course}_teachers`, name: "All instructors" }); return drawCompose(); }
  const rm = t.closest("[data-rm-rcpt]");
  if (rm) { box.compose.to.splice(+rm.dataset.rmRcpt, 1); return drawCompose(); }
});

$("view").addEventListener("change", e => {
  const t = e.target;
  if (t.id === "todo-hide") { todo.hideDone = t.checked; return renderTodo(); }
  if (t.dataset.calcourse) {
    const id = t.dataset.calcourse, hidden = new Set(prefs.calHidden);
    t.checked ? hidden.delete(id) : hidden.add(id);
    prefs.calHidden = [...hidden]; savePrefs();
    drawMonth(); drawCalSide();
    return;
  }
  if (t.id === "mail-course") { box.course = t.value; return drawMailList(location.hash.split("/")[2]); }
  if (t.id === "c-course") {
    const d = box.compose;
    d.subject = $("c-subject").value; d.body = $("c-body").value;
    d.course = t.value; d.to = []; box.results = [];
    return drawCompose();
  }
});

$("view").addEventListener("input", e => {
  const t = e.target;
  if (t.id === "msg-text") { const k = `draft:msg:${t.dataset.convoId}`; t.value ? store.set(k, t.value) : store.del(k); }
  if (t.id === "to-search") searchPeople(t.value);
  if (t.id === "c-subject" && box.compose) box.compose.subject = t.value;
  if (t.id === "c-body" && box.compose) box.compose.body = t.value;
});

// ---------- Announcements ----------
// "New" = unread in Canvas and not yet seen here. Seeing them here is remembered in this
// browser only; Canvas still shows them unread until you open them there.
let seenAnns = store.get("seenAnns") || {};
const isNewAnn = a => a.unread && !seenAnns[a.id];
const annState = { course: "" };

function markAnnouncementsSeen(list) {
  let changed = false;
  for (const a of list) if (isNewAnn(a)) { seenAnns[a.id] = 1; changed = true; }
  if (!changed) return;
  store.set("seenAnns", seenAnns);
  // Leave this visit's "New" tags in place; the badge drops right away.
  setTimeout(updateBadges, 0);
}

function announcementsHTML(list, showCourse) {
  if (!list.length) return `<section class="card"><p class="empty" style="padding-top:20px">No announcements in the last two months.</p></section>`;
  return `<div class="anns">${list.map((a, i) => {
    const c = byId[a.courseId];
    return `<details class="card annc" ${i === 0 || isNewAnn(a) ? "open" : ""}>
      <summary>
        <div class="meta">${showCourse && c ? `<span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))} · ` : ""}${a.author ? `${esc(a.author)} · ` : ""}${fmtFull(a.when)}</div>
        <h3>${esc(a.title)}${isNewAnn(a) ? '<span class="pill new">New</span>' : ""}</h3>
        <p class="preview">${esc(a.body)}</p>
      </summary>
      <div class="prose">${a.html || `<p>${esc(a.body)}</p>`}</div>
      ${a.files?.length ? `<ul class="rows">${a.files.map(fileRow).join("")}</ul>` : ""}
      ${a.url ? `<div class="ann-foot"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open in Canvas to reply ↗</a></div>` : ""}
    </details>`;
  }).join("")}</div>`;
}

function renderAnnouncements() {
  const list = S.announcements.filter(a => !annState.course || a.courseId === annState.course);
  const fresh = S.announcements.filter(isNewAnn).length;
  $("view").innerHTML = `
    <header class="hello"><div><h1>Announcements</h1><p>${fresh ? `${fresh} new since you last looked.` : "From your classes over the last two months."}</p></div></header>
    <div class="filters" style="padding:0 0 16px">
      <button class="fchip ${!annState.course ? "on" : ""}" data-ann-course="">All classes</button>
      ${S.courses.map(c => { const n = S.announcements.filter(a => a.courseId === c.id).length; return n ? `<button class="fchip ${annState.course === c.id ? "on" : ""}" data-ann-course="${esc(c.id)}"><span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))} <span class="meta">${n}</span></button>` : ""; }).join("")}
    </div>
    ${announcementsHTML(list, !annState.course)}`;
  markAnnouncementsSeen(list);
}

// ---------- Badges ----------
// To-do: things not done yet that are due within the next two days.
function updateBadges() {
  if (!S) return;
  const t = Date.now();
  const urgent = S.planner.filter(p => !isDone(p) && p.due - t > 0 && p.due - t <= 2 * DAY).length;
  const anns = S.announcements.filter(isNewAnn).length;
  const set = (id, n) => { const b = $(id); b.textContent = n > 99 ? "99+" : n; b.hidden = !n; };
  set("todo-badge", urgent);
  set("ann-badge", anns);
  set("ann-badge-m", anns);
  set("more-badge", anns);
}

$("nav-more").onclick = e => {
  e.stopPropagation();
  const m = $("more-menu");
  m.hidden = !m.hidden;
  $("nav-more").setAttribute("aria-expanded", String(!m.hidden));
};
document.addEventListener("click", e => { if (!e.target.closest("#more-menu, #nav-more")) $("more-menu").hidden = true; });

// Refresh: drop everything cached and load fresh from Canvas, keeping filters and the current page.
$("refresh").onclick = async () => {
  const btn = $("refresh");
  if (btn.classList.contains("spinning")) return;
  btn.classList.add("spinning");
  for (const o of [details, loaded, assignmentsCache, ranges, box.lists, box.convos, courseFiles]) for (const k in o) delete o[k];
  try {
    const fresh = await source().loadAll();
    S = fresh;
    byId = Object.fromEntries(S.courses.map(c => [c.id, c]));
    applyPrefs();
    route();
    refreshUnread();
    toast("Up to date");
  } catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
    toast("Couldn't refresh. Check your connection.");
  } finally {
    btn.classList.remove("spinning");
  }
};

// Forget everything these pages cached (called on sign-out).
function resetViews() {
  for (const o of [ranges, box.lists, box.convos, courseFiles, FILES]) for (const k in o) delete o[k];
  Object.assign(cal, { month: null, selected: null, start: null, data: null });
  Object.assign(box, { scope: "inbox", course: "", compose: null, results: [] });
  Object.assign(todo, { course: "", hideDone: false });
  annState.course = "";
  unread = 0;
  for (const id of ["inbox-badge", "todo-badge", "ann-badge", "ann-badge-m", "more-badge"]) $(id).hidden = true;
}
// boot() runs from start.js, after every page script has loaded.
