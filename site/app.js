"use strict";

// ---------- Helpers ----------
const DAY = 864e5;
let now = new Date();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null;
const safeUrl = u => /^https:\/\//i.test(u || "") ? u : null;
const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const byDue = (a, b) => (a.due || Infinity) - (b.due || Infinity);
const num = n => String(+(+n).toFixed(2));
const htmlToText = html => new DOMParser().parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();
const fmtSize = b => b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtFull = d => d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const relDay = d => {
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days > 0 ? `in ${days} days` : `${-days} days ago`;
};

// Canvas's default grading scheme, used for estimates (official letters come from Canvas).
const SCALE = [[94, "A"], [90, "A-"], [87, "B+"], [84, "B"], [80, "B-"], [77, "C+"], [74, "C"], [70, "C-"], [67, "D+"], [64, "D"], [61, "D-"]];
const letterOf = g => g == null ? "–" : (SCALE.find(([min]) => g >= min) || [0, "F"])[1];

function fmtWhen(d) {
  if (!d) return "No due date";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, new Date(now.getTime() + DAY))) return `Tomorrow ${time}`;
  if (sameDay(d, new Date(now.getTime() - DAY))) return `Yesterday ${time}`;
  if (d > now && d - now < 6 * DAY) return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
const ago = d => { const h = Math.round((now - d) / 36e5); return h < 24 ? `${Math.max(h, 1)}h ago` : `${Math.round(h / 24)}d ago`; };

// Teacher-written HTML from Canvas, cut down to plain formatting: scripts, styles, frames,
// forms and every attribute except a few safe ones are removed. Returns the cleaned
// document plus the Canvas file ids it links to, so those can be swapped for real download links.
const KEEP_TAGS = new Set("A ABBR B BLOCKQUOTE BR CAPTION CODE DD DEL DIV DL DT EM FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 HR I IMG INS KBD LI MARK OL P PRE Q S SMALL SPAN STRONG SUB SUP TABLE TBODY TD TFOOT TH THEAD TR U UL".split(" "));
const DROP_TAGS = new Set("SCRIPT STYLE IFRAME OBJECT EMBED FORM INPUT BUTTON TEXTAREA SELECT OPTION LINK META NOSCRIPT TEMPLATE SVG MATH VIDEO AUDIO SOURCE TRACK CANVAS FRAME FRAMESET BASE TITLE".split(" "));

function cleanHTML(html, host = "canvas.invalid") {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const fileIds = new Set();
  const toAbs = u => { try { const x = new URL(u, `https://${host}/`); return /^(https?|mailto):$/.test(x.protocol) ? x : null; } catch { return null; } };
  const external = (el, href) => { el.setAttribute("href", href); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); };
  const walk = parent => {
    for (const el of [...parent.children]) {
      if (DROP_TAGS.has(el.tagName)) {
        const src = el.tagName === "IFRAME" && toAbs(el.getAttribute("src") || "");
        if (src && src.protocol === "https:") {
          const a = doc.createElement("a");
          external(a, src.href);
          a.textContent = "Open embedded content ↗";
          el.replaceWith(a);
        } else el.remove();
        continue;
      }
      walk(el);
      if (!KEEP_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      const get = n => el.getAttribute(n) || "";
      const href = get("href"), src = get("src"), alt = get("alt"), colspan = get("colspan"), rowspan = get("rowspan");
      const fileId = (/\/files\/([0-9~]+)/.exec(get("data-api-endpoint") || (el.tagName === "IMG" ? src : el.tagName === "A" ? href : "")) || [])[1];
      for (const a of [...el.attributes]) el.removeAttribute(a.name);
      if (fileId) { el.setAttribute("data-file-id", fileId); fileIds.add(fileId); }
      if (el.tagName === "A" && href) {
        const u = toAbs(href);
        const inner = u && u.host === host && /^\/courses\/([0-9~]+)\/assignments\/([0-9~]+)\/?$/.exec(u.pathname);
        if (inner) el.setAttribute("href", `#/course/${inner[1]}/a/${inner[2]}`);
        else if (u) external(el, u.href);
      }
      if (el.tagName === "IMG") {
        const u = src && toAbs(src);
        if (!u || u.protocol !== "https:") { el.remove(); continue; }
        el.setAttribute("src", u.href);
        el.setAttribute("loading", "lazy");
        if (alt) el.setAttribute("alt", alt);
      }
      if (colspan && /^\d+$/.test(colspan)) el.setAttribute("colspan", colspan);
      if (rowspan && /^\d+$/.test(rowspan)) el.setAttribute("rowspan", rowspan);
    }
  };
  walk(doc.body);
  return { doc, fileIds: [...fileIds] };
}
const cleanText = (html, host) => cleanHTML(html, host).doc.body.innerHTML;

// ---------- Browser storage (the only place a token ever lives) ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) ?? sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v, persist = true) { try { (persist ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
};

const DEFAULTS = { site: "Coursework", name: "", accent: "#3b5bdb", theme: "system", nick: {}, colors: {}, rest: 100, calHidden: [] };
const ACCENTS = ["#3b5bdb", "#7048e8", "#c2255c", "#e8590c", "#2b8a3e", "#0c8599", "#1b1a17"];
const PALETTE = ["#3b5bdb", "#2b8a3e", "#e8590c", "#ae3ec9", "#0c8599", "#c2255c", "#5f3dc4", "#e67700", "#1971c2", "#087f5b"];

let session = store.get("session");          // { host, token } or { demo: true }
let prefs = { ...DEFAULTS, ...(store.get("prefs") || {}) };
let done = store.get("done") || {};           // local checkmarks, keyed by planner item
const savePrefs = () => store.set("prefs", prefs);

// ---------- Canvas API (through the pass-through proxy on our own domain) ----------
class AuthError extends Error {}
class ApiError extends Error {
  constructor(status, detail = "") { super(detail || `Canvas returned ${status}`); this.status = status; this.detail = detail; }
}

const toParams = params => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) [].concat(v).forEach(x => q.append(k, x));
  return q;
};
const nextPage = (link, host) => {
  const m = /<([^>]+)>;\s*rel="next"/.exec(link || "");
  if (!m) return null;
  const u = new URL(m[1]);
  return `/proxy/${host}${u.pathname}${u.search}`;
};
// Turns a Canvas URL (absolute or relative) into the same request through our proxy.
const proxyPath = loc => {
  if (loc.startsWith("/proxy/")) return loc;
  if (loc.startsWith("/")) return `/proxy/${session.host}${loc}`;
  const u = new URL(loc);
  return `/proxy/${u.host}${u.pathname}${u.search}`;
};
// Pulls the human-readable part out of a Canvas error body.
function canvasMessage(text) {
  try {
    const j = JSON.parse(text);
    const e = j.errors ?? j.message ?? j.error;
    if (typeof e === "string") return e;
    if (Array.isArray(e)) return e[0]?.message || "";
    if (e && typeof e === "object") { const first = Object.values(e).flat()[0]; return typeof first === "string" ? first : first?.message || ""; }
  } catch {}
  return "";
}

// Where Canvas may tell us to send file uploads. Must match the /upload/ rule in the nginx config.
const UPLOAD_HOST = /^((?:[a-z0-9-]+\.)*(?:instructure\.com|inscloudgate\.net)|instructure-uploads[a-z0-9-]*\.s3[a-z0-9.-]*\.amazonaws\.com)$/;

function xhrUpload(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => resolve({ status: x.status, location: x.getResponseHeader("X-Cnv-Location") || x.getResponseHeader("Location"), body: x.responseText });
    x.onerror = () => reject(new ApiError("network"));
    x.send(form);
  });
}

const Canvas = {
  async request(url, { method = "GET", body, auth = session } = {}) {
    let res;
    try {
      res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json+canvas-string-ids" }, cache: "no-store" });
    } catch { throw new ApiError("network"); }
    if (res.status === 401) {
      const text = await res.text();
      // A bad or expired token gets WWW-Authenticate; a page the student can't see doesn't.
      if (res.headers.has("WWW-Authenticate") || /invalid access token|expired/i.test(text)) throw new AuthError();
      throw new ApiError(401, canvasMessage(text));
    }
    if (!res.ok) throw new ApiError(res.status, canvasMessage(await res.text().catch(() => "")));
    return res;
  },

  async get(path, params = {}, all = false, auth = session) {
    let url = `/proxy/${auth.host}/api/v1/${path}?${toParams(params)}`, out = [];
    for (let page = 0; url && page < 20; page++) {
      const res = await this.request(url, { auth });
      const data = await res.json();
      if (!all) return data;
      out = out.concat(data);
      url = nextPage(res.headers.get("Link"), auth.host);
    }
    return out;
  },

  async post(path, params) {
    const res = await this.request(`/proxy/${session.host}/api/v1/${path}`, { method: "POST", body: toParams(params) });
    return res.json();
  },

  abs: path => !path ? null : path.startsWith("/") ? `https://${session.host}${path}` : safeUrl(path),

  // Planner items (assignments, quizzes, graded discussions, to-dos) in the shape the pages use.
  mapPlanner(list) {
    const kindOf = t => /quiz/.test(t) ? "quiz" : /discussion/.test(t) ? "discussion" : /wiki_page/.test(t) ? "page" : "assignment";
    return list
      .filter(p => p.plannable_date && !["announcement", "calendar_event", "assessment_request"].includes(p.plannable_type))
      .map(p => ({
        key: `${p.plannable_type}-${p.plannable_id}`,
        courseId: p.course_id ? String(p.course_id) : null,
        assignmentId: p.plannable_type === "assignment" ? String(p.plannable_id) : p.plannable?.assignment_id ? String(p.plannable.assignment_id) : null,
        title: p.plannable?.title || p.plannable?.name || "Untitled",
        due: new Date(p.plannable_date),
        pts: p.plannable?.points_possible ?? null,
        submitted: !!(p.planner_override?.marked_complete || p.submissions?.submitted || p.submissions?.graded || p.submissions?.excused),
        missing: !!p.submissions?.missing,
        url: this.abs(p.html_url),
        kind: kindOf(p.plannable_type),
      }));
  },

  async loadAll() {
    const iso = d => new Date(Date.now() + d * DAY).toISOString();
    const [user, raw, colors] = await Promise.all([
      this.get("users/self"),
      this.get("courses", { enrollment_state: "active", "include[]": ["total_scores", "current_grading_period_scores", "teachers", "term"], per_page: 100 }, true),
      this.get("users/self/colors").catch(() => ({})),
    ]);
    const courses = raw.filter(c => c.name && !c.access_restricted_by_date).map((c, i) => {
      const e = (c.enrollments || []).find(e => e.type === "student") || (c.enrollments || [])[0] || {};
      return {
        id: String(c.id),
        code: c.course_code || "",
        name: c.name,
        color: safeColor(colors.custom_colors?.[`course_${c.id}`]) || PALETTE[i % PALETTE.length],
        score: e.current_period_computed_current_score ?? e.computed_current_score ?? null,
        letter: e.current_period_computed_current_grade ?? e.computed_current_grade ?? null,
        hidden: !!c.hide_final_grades,
        weighted: !!c.apply_assignment_group_weights,
        teachers: (c.teachers || []).map(t => t.display_name),
        term: c.term?.name && c.term.name !== "Default Term" ? c.term.name : "",
        url: `https://${session.host}/courses/${c.id}`,
      };
    });
    const [planner, anns] = await Promise.all([
      this.get("planner/items", { start_date: iso(-14), end_date: iso(28), per_page: 100 }, true).catch(() => []),
      courses.length
        ? this.get("announcements", { "context_codes[]": courses.map(c => `course_${c.id}`), start_date: iso(-60), end_date: iso(0), per_page: 50 }, true).catch(() => [])
        : [],
    ]);
    return {
      user: { id: String(user.id), name: user.short_name || user.name || "" },
      courses,
      planner: this.mapPlanner(planner),
      announcements: anns.map(a => {
        const courseId = String(a.context_code || "").replace("course_", "");
        return {
          id: String(a.id),
          courseId,
          title: a.title,
          body: htmlToText(a.message),
          html: cleanText(a.message, session.host),
          author: a.author?.display_name || a.user_name || "",
          when: new Date(a.posted_at || a.created_at),
          unread: a.read_state === "unread",
          url: safeUrl(a.html_url),
          files: (a.attachments || []).map(f => ({ id: String(f.id), name: f.display_name, size: f.size, type: f["content-type"] || "", url: safeUrl(f.url), courseId })),
        };
      }).sort((a, b) => b.when - a.when),
    };
  },

  async loadCourse(c) {
    const [groups, modules] = await Promise.all([
      this.get(`courses/${c.id}/assignment_groups`, { "include[]": ["assignments", "submission"], per_page: 100 }, true),
      this.get(`courses/${c.id}/modules`, { "include[]": ["items"], per_page: 50 }, true).catch(() => null),
    ]);
    return {
      weighted: c.weighted,
      groups: groups.map(g => ({
        id: String(g.id),
        name: g.name,
        weight: g.group_weight || 0,
        rules: g.rules || {},
        items: (g.assignments || []).filter(a => a.published !== false).map(a => {
          const s = a.submission || {};
          return {
            key: `a${a.id}`, id: String(a.id), title: a.name, groupName: g.name,
            pts: a.points_possible || 0,
            due: a.due_at ? new Date(a.due_at) : null,
            score: s.excused ? null : (s.score ?? null),
            excused: !!s.excused,
            omit: !!a.omit_from_final_grade,
            submitted: !!s.submitted_at,
            gradedAt: s.graded_at ? new Date(s.graded_at) : null,
            missing: !!s.missing,
            late: !!s.late,
            url: safeUrl(a.html_url),
            kind: a.is_quiz_assignment || a.quiz_id ? "quiz" : (a.submission_types || []).includes("discussion_topic") ? "discussion" : "assignment",
          };
        }),
      })),
      modules: modules && modules.map(m => ({
        name: m.name,
        items: (m.items || []).map(it => ({
          type: it.type, title: it.title, url: safeUrl(it.html_url),
          assignmentId: it.type === "Assignment" && it.content_id ? String(it.content_id) : null,
          done: it.completion_requirement ? !!it.completion_requirement.completed : null,
        })),
      })),
    };
  },

  async loadAssignment(c, aid) {
    const host = session.host;
    const [a, s] = await Promise.all([
      this.get(`courses/${c.id}/assignments/${aid}`, { "include[]": ["submission", "score_statistics"] }),
      this.get(`courses/${c.id}/assignments/${aid}/submissions/self`, { "include[]": ["submission_comments", "rubric_assessment"] }).catch(() => null),
    ]);
    const topic = a.discussion_topic || null;
    const { doc, fileIds } = cleanHTML(a.description || topic?.message || "", host);

    // Files linked from the instructions, plus anything attached to a graded discussion.
    const fetched = await Promise.all(fileIds.slice(0, 20).map(id => this.get(`files/${id}`).catch(() => null)));
    const files = [...fetched.filter(Boolean), ...(topic?.attachments || [])].map(f => ({
      id: String(f.id), name: f.display_name || f.filename, size: f.size, type: f["content-type"] || "", url: safeUrl(f.url), courseId: c.id,
    }));
    const byFile = Object.fromEntries(files.map(f => [f.id, f]));
    doc.querySelectorAll("[data-file-id]").forEach(el => {
      const f = byFile[el.getAttribute("data-file-id")];
      if (!f?.url) return;
      if (el.tagName === "IMG") el.setAttribute("src", f.url);
      else { el.setAttribute("href", f.url); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    });

    let entries = null;
    if (topic) {
      try {
        const view = await this.get(`courses/${c.id}/discussion_topics/${topic.id}/view`);
        const names = Object.fromEntries((view.participants || []).map(p => [String(p.id), p.display_name]));
        const mapEntry = e => ({
          author: names[String(e.user_id)] || "Someone", html: cleanText(e.message, host), when: new Date(e.created_at),
          replies: (e.replies || []).filter(r => !r.deleted).map(mapEntry),
        });
        entries = (view.view || []).filter(e => !e.deleted).map(mapEntry);
      } catch (e) {
        if (e instanceof AuthError) throw e;
        entries = e.status === 403 ? "locked" : null;
      }
    }

    const assessed = s?.rubric_assessment || {};
    return {
      id: String(a.id),
      title: a.name,
      html: doc.body.innerHTML,
      due: a.due_at ? new Date(a.due_at) : null,
      lockAt: a.lock_at ? new Date(a.lock_at) : null,
      pts: a.points_possible || 0,
      types: a.submission_types || [],
      ext: (a.allowed_extensions || []).map(x => x.toLowerCase()),
      attempts: a.allowed_attempts ?? -1,
      locked: !!a.locked_for_user,
      lockText: a.lock_explanation ? htmlToText(a.lock_explanation) : "",
      url: safeUrl(a.html_url),
      stats: a.score_statistics || null,
      files,
      rubric: a.rubric ? a.rubric.map(r => ({
        id: String(r.id), title: r.description, long: r.long_description || "", pts: r.points,
        ratings: (r.ratings || []).map(x => ({ id: String(x.id), title: x.description, long: x.long_description || "", pts: x.points })),
        got: assessed[r.id] ? { pts: assessed[r.id].points, rating: String(assessed[r.id].rating_id ?? ""), comment: assessed[r.id].comments || "" } : null,
      })) : null,
      sub: s && {
        score: s.score ?? null,
        grade: s.grade ?? null,
        graded: s.workflow_state === "graded" && s.score != null,
        submittedAt: s.submitted_at ? new Date(s.submitted_at) : null,
        attempt: s.attempt || 0,
        late: !!s.late, missing: !!s.missing, excused: !!s.excused,
        body: s.body ? cleanText(s.body, host) : "",
        url: /^https?:\/\//i.test(s.url || "") ? s.url : null,
        files: (s.attachments || []).map(f => ({ name: f.display_name, size: f.size, url: safeUrl(f.url) })),
        comments: (s.submission_comments || []).map(cm => ({
          author: cm.author_name || cm.author?.display_name || "Teacher", text: cm.comment || "", when: new Date(cm.created_at),
          files: (cm.attachments || []).map(f => ({ name: f.display_name, size: f.size, url: safeUrl(f.url) })),
        })),
      },
      discussion: topic ? { id: String(topic.id), entries } : null,
    };
  },

  async uploadFile(c, aid, file, onProgress) {
    const pre = await this.post(`courses/${c.id}/assignments/${aid}/submissions/self/files`, {
      name: file.name, size: file.size, content_type: file.type || "application/octet-stream", on_duplicate: "rename",
    });
    const u = new URL(pre.upload_url);
    if (!UPLOAD_HOST.test(u.host)) throw new ApiError("upload", `Canvas wanted to upload to ${u.host}, which Coursework doesn't allow yet.`);
    const form = new FormData();
    for (const [k, v] of Object.entries(pre.upload_params || {})) form.append(k, v);
    form.append("file", file);
    const res = await xhrUpload(`/upload/${u.host}${u.pathname}${u.search}`, form, onProgress);
    if (res.status >= 400) throw new ApiError(res.status, canvasMessage(res.body) || "The upload was rejected.");
    let data = {};
    try { data = JSON.parse(res.body); } catch {}
    if (!data.id) {
      // Canvas confirms some uploads with a redirect; the proxy hands us where it pointed.
      const loc = res.location || data.location;
      if (!loc) throw new ApiError("upload", "Canvas didn't confirm the upload.");
      data = await (await this.request(proxyPath(loc))).json();
    }
    return data.id;
  },

  async submit(c, a, type, payload, onProgress) {
    const base = `courses/${c.id}/assignments/${a.id}/submissions`;
    if (type === "discussion") return this.post(`courses/${c.id}/discussion_topics/${a.discussion.id}/entries`, { message: payload.html });
    if (type === "online_text_entry") return this.post(base, { "submission[submission_type]": type, "submission[body]": payload.html });
    if (type === "online_url") return this.post(base, { "submission[submission_type]": type, "submission[url]": payload.url });
    if (type === "online_upload") {
      const ids = [];
      for (const [i, f] of payload.files.entries()) {
        onProgress(i / payload.files.length, `Uploading ${f.name}${payload.files.length > 1 ? ` (${i + 1} of ${payload.files.length})` : ""}…`);
        ids.push(await this.uploadFile(c, a.id, f, p => onProgress((i + p) / payload.files.length)));
      }
      onProgress(1, "Turning it in…");
      return this.post(base, { "submission[submission_type]": type, "submission[file_ids][]": ids });
    }
    throw new ApiError("type", "That kind of submission isn't supported here.");
  },
};

const source = () => session?.demo ? window.DEMO : Canvas;

// ---------- App state ----------
let S = null;                 // { user, courses, planner, announcements }
let byId = {};
const details = {};           // course id -> promise of course detail
const loaded = {};            // course id -> resolved course detail
const assignmentsCache = {};  // "course/assignment" -> promise of assignment detail
const whatIf = {};            // hypothetical scores by item key; like Canvas, gone on reload
const subState = {};          // per-assignment submit form: { type, files }
let current = null;           // { c, a } on the assignment page

const getDetail = c => details[c.id] ??= source().loadCourse(c)
  .then(d => (loaded[c.id] = d))
  .catch(e => { delete details[c.id]; throw e; });
const getAssignment = (c, aid) => assignmentsCache[`${c.id}/${aid}`] ??= source().loadAssignment(c, aid)
  .catch(e => { delete assignmentsCache[`${c.id}/${aid}`]; throw e; });

const cName = c => prefs.nick[c.id] || c.name;
const cColor = c => safeColor(prefs.colors[c.id]) || c.color;
const displayName = () => prefs.name.trim() || S?.user.name || "";
const firstName = () => displayName().split(/\s+/)[0] || "there";
const initials = () => displayName().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
const isDone = p => p.key in done ? done[p.key] : p.submitted;
const courseInView = () => byId[location.hash.split("/")[2]];
const aLink = (cid, aid) => `#/course/${cid}/a/${aid}`;

// ---------- Grade math ----------
// Canvas-style: groups with nothing scored are left out and the rest re-weighted.
// scoreOf decides each item's score (null = not counted).
function calc(d, scoreOf) {
  const groups = {};
  let earned = 0, weight = 0, got = 0, possible = 0;
  for (const g of d.groups) {
    const scored = dropScores(g.items.filter(it => !it.excused && !it.omit && scoreOf(it) != null), g.rules, scoreOf);
    const s = sum(scored, scoreOf), p = sum(scored, it => it.pts);
    groups[g.id] = p > 0 ? s / p * 100 : null;
    if (p > 0) { earned += s / p * g.weight; weight += g.weight; }
    got += s; possible += p;
  }
  const total = d.weighted && weight > 0 ? earned / weight * 100 : possible > 0 ? got / possible * 100 : null;
  return { total, groups };
}

// Approximates Canvas's "drop lowest/highest" group rules.
function dropScores(items, rules, scoreOf) {
  const lo = rules.drop_lowest || 0, hi = rules.drop_highest || 0;
  if (!lo && !hi) return items;
  const keep = new Set((rules.never_drop || []).map(String));
  const ranked = items.filter(it => it.pts > 0 && !keep.has(it.id)).sort((a, b) => scoreOf(a) / a.pts - scoreOf(b) / b.pts);
  const out = new Set();
  let i = 0, j = ranked.length - 1;
  for (let k = 0; k < lo && j > i; k++) out.add(ranked[i++]);
  for (let k = 0; k < hi && j > i; k++) out.add(ranked[j--]);
  return items.filter(it => !out.has(it));
}

const actual = it => it.score;
const withWhatIf = it => whatIf[it.key] ?? it.score;
const withRest = it => it.score ?? (it.pts > 0 ? it.pts * prefs.rest / 100 : null);
const allItems = d => d.groups.flatMap(g => g.items);
const officialScore = (c, d) => c.score ?? (d ? calc(d, actual).total : null);

// ---------- Shared bits of markup ----------
const ICON = {
  assignment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/></svg>',
  discussion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  chev: '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  tick: '<svg class="tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l5 5L20 7"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>',
};
const MODULE_ICON = { Assignment: "assignment", Quiz: "quiz", Discussion: "discussion", Page: "page", File: "file", ExternalUrl: "link", ExternalTool: "link" };
const TYPE_LABEL = {
  online_text_entry: "Text entry", online_url: "Website link", online_upload: "File upload", discussion_topic: "Discussion post",
  online_quiz: "Quiz", external_tool: "Outside tool", media_recording: "Media recording", student_annotation: "Annotation",
  on_paper: "On paper", none: "Nothing online", not_graded: "Not graded",
};
const SUBMITTABLE = ["online_text_entry", "online_url", "online_upload"];

const loadingHTML = text => `<div class="loading"><span class="spin"></span>${esc(text)}</div>`;
const errorHTML = e => `<div class="card error-card">
  <h2>Couldn't load this from Canvas</h2>
  <p>${e?.status === "network" ? "The connection dropped. Check your internet and try again." : e?.status === 401 || e?.status === 403 ? "Canvas says you don't have access to this." : e?.status === 404 ? "Canvas couldn't find this. It may have been deleted or unpublished." : "Something went wrong on the way to Canvas. Try again in a moment."}</p>
  <button class="btn" data-action="retry">Try again</button>
</div>`;
// Internal links (#/...) stay in the app; Canvas links open in a new tab; no link renders a plain row.
const rowLink = (url, inner) => !url ? `<div class="row">${inner}</div>`
  : url.startsWith("#") ? `<a class="row" href="${esc(url)}">${inner}</a>`
  : `<a class="row" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
const statusPill = it => it.excused ? '<span class="pill">Excused</span>'
  : it.missing && it.score == null ? '<span class="pill late">Missing</span>'
  : it.late ? '<span class="pill late">Late</span>'
  : it.submitted && it.score == null ? '<span class="pill ok">Submitted</span>' : "";

function dueRow(p, showCourse = true) {
  const c = byId[p.courseId], d = isDone(p), urgent = !d && (p.missing || p.due - now < DAY);
  const href = c && p.assignmentId ? aLink(c.id, p.assignmentId) : p.url;
  const title = !href ? `<span class="t">${esc(p.title)}</span>`
    : href.startsWith("#") ? `<a class="t" href="${esc(href)}">${esc(p.title)}</a>`
    : `<a class="t" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>`;
  return `<li class="${d ? "done" : ""}" data-key="${esc(p.key)}">
    <button class="check" aria-label="${d ? "Mark not done" : "Mark done"}">${d ? ICON.check : ""}</button>
    <div>${title}<div class="meta">${showCourse && c ? `<span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))}` : ""}${p.pts ? `<span>${num(p.pts)} pts</span>` : ""}${p.missing && !d ? '<span class="pill late">Missing</span>' : ""}</div></div>
    <span class="when ${urgent ? "soon" : ""}">${fmtWhen(p.due)}</span>
  </li>`;
}

const annHTML = list => list.map(a => {
  const c = byId[a.courseId];
  const inner = `<div class="meta">${c ? `<span class="dot" style="background:${cColor(c)}"></span>${esc(c.code || cName(c))} · ` : ""}${ago(a.when)}</div><h4>${esc(a.title)}</h4><p>${esc(a.body)}</p>`;
  return `<article>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner}</article>`;
}).join("");

// Files with an id open in the in-app viewer (files.js); others link out to Canvas.
const fileRow = f => {
  const inner = `<span class="type">${ICON.file}</span>
    <div><div class="rt">${esc(f.name)}</div><div class="meta">${[fmtSize(f.size), (f.name.split(".").pop() || "").toUpperCase()].filter(Boolean).join(" · ")}</div></div>
    <span class="meta">${f.id ? "Open" : f.url ? "Download ↗" : ""}</span>`;
  if (f.id && (f.url || f.demoText != null)) { FILES[f.id] = f; return `<li><button class="row frow" data-view-file="${esc(f.id)}">${inner}</button></li>`; }
  return `<li>${rowLink(f.url, inner)}</li>`;
};

// ---------- Home ----------
function renderHome() {
  const hr = now.getHours();
  const week = S.planner.filter(p => p.due >= startOfDay(now) && p.due - now < 7 * DAY);
  const missing = S.planner.filter(p => p.missing && !isDone(p) && p.due < startOfDay(now));
  const open = week.filter(p => !isDone(p));
  const today = open.filter(p => sameDay(p.due, now)).length;
  const scored = S.courses.filter(c => c.score != null);
  const avg = scored.length ? sum(scored, c => c.score) / scored.length : null;
  const list = [...missing, ...week].sort(byDue);

  $("view").innerHTML = `
    <header class="hello">
      <div>
        <h1>Good ${hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening"}, <em>${esc(firstName())}</em></h1>
        <p>${today ? `${today} thing${today > 1 ? "s" : ""} due today, ${open.length} this week.` : open.length ? `Nothing due today. ${open.length} thing${open.length > 1 ? "s" : ""} this week.` : "Nothing due this week."}</p>
      </div>
      <div class="stats">
        <div class="stat"><b>${open.length}</b><span>due this week</span></div>
        ${missing.length ? `<div class="stat warn"><b>${missing.length}</b><span>missing</span></div>` : ""}
        <div class="stat"><b>${avg == null ? "–" : avg.toFixed(1) + "%"}</b><span>average grade</span></div>
        <div class="stat"><b>${S.courses.length}</b><span>courses</span></div>
      </div>
    </header>
    <div class="grid">
      <section class="card">
        <div class="card-h"><h2>This week</h2><a href="#/todo">Full to-do →</a></div>
        <div class="week">${Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now.getTime() + i * DAY);
          const pips = S.planner.filter(p => sameDay(p.due, d)).slice(0, 4).map(p => `<i style="background:${byId[p.courseId] ? cColor(byId[p.courseId]) : "var(--muted)"}"></i>`).join("");
          return `<div class="day ${i === 0 ? "today" : ""}"><small>${d.toLocaleDateString([], { weekday: "short" })}</small><b>${d.getDate()}</b><div class="pips">${pips}</div></div>`;
        }).join("")}</div>
        ${list.length ? `<ul class="due">${list.map(p => dueRow(p)).join("")}</ul>` : `<p class="empty">Nothing due this week. Enjoy it.</p>`}
      </section>
      <section class="card">
        <div class="card-h"><h2>Announcements</h2><a href="#/announcements">See all →</a></div>
        ${S.announcements.length ? `<div class="ann">${annHTML(S.announcements.slice(0, 4))}</div>` : `<p class="empty">No recent announcements.</p>`}
      </section>
    </div>
    <h2 class="section-title">Your courses</h2>
    ${S.courses.length ? `<div class="courses">${S.courses.map(c => {
      const next = S.planner.filter(p => p.courseId === c.id && !isDone(p) && p.due >= now).sort(byDue)[0];
      return `<a href="#/course/${c.id}" class="card course" style="--c:${cColor(c)}">
        <div class="code">${esc(c.code)}</div><h3>${esc(cName(c))}</h3>
        ${c.hidden ? `<div class="grade-row"><span class="grade">–</span><span style="color:var(--muted);font-size:14px">Grade hidden</span></div><div class="bar"></div>`
          : `<div class="grade-row"><span class="grade">${esc(c.letter || letterOf(c.score))}</span><span style="color:var(--muted);font-size:14px">${c.score == null ? "No grades yet" : c.score.toFixed(1) + "%"}</span></div>
             <div class="bar"><i style="width:${Math.min(c.score ?? 0, 100)}%"></i></div>`}
        <div class="next">${next ? `Next: ${esc(next.title)} · ${fmtWhen(next.due)}` : "Nothing due soon"}</div>
      </a>`;
    }).join("")}</div>` : `<p class="empty" style="padding-left:0">No active courses found.</p>`}`;
}

// ---------- All grades ----------
function renderGrades() {
  $("view").innerHTML = `
    <header class="hello"><div><h1>Grades</h1><p>Current grades across your courses. Open one for what-if scores.</p></div></header>
    <section class="card">${S.courses.map(c => `
      <a class="grow" href="#/course/${c.id}/grades" style="--c:${cColor(c)}">
        <span class="dot" style="background:${cColor(c)}"></span>
        <div><div style="font-weight:600">${esc(cName(c))}</div><div class="meta">${esc(c.code)}</div></div>
        <div class="bar"><i style="width:${c.hidden ? 0 : Math.min(c.score ?? 0, 100)}%"></i></div>
        <span class="score">${c.hidden ? "<b>–</b><small>Hidden</small>" : `<b>${esc(c.letter || letterOf(c.score))}</b><small>${c.score == null ? "No grades" : c.score.toFixed(1) + "%"}</small>`}</span>
      </a>`).join("") || `<p class="empty" style="padding-top:20px">No active courses found.</p>`}
    </section>`;
}

// ---------- Course page ----------
const TABS = [["overview", "Overview"], ["assignments", "Assignments"], ["modules", "Modules"], ["files", "Files"], ["announcements", "Announcements"], ["grades", "Grades"]];

async function renderCourse(id, tab) {
  const c = byId[id];
  if (!c) return renderHome();
  tab = TABS.some(([k]) => k === tab) ? tab : "overview";
  const hash = location.hash;
  $("view").innerHTML = `<div style="--c:${cColor(c)}">
    <a href="#/" class="back">← All courses</a>
    <section class="hero">
      <div>
        <div class="code">${esc(c.code)}</div>
        <h1>${esc(cName(c))}</h1>
        <div class="info">${[c.teachers.join(", "), c.term].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join("")}</div>
      </div>
      ${safeUrl(c.url) ? `<a class="open" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open in Canvas ↗</a>` : ""}
    </section>
    <nav class="tabs">${TABS.filter(([k]) => k !== "modules" || !loaded[c.id] || loaded[c.id].modules?.length).map(([k, l]) => `<a href="#/course/${c.id}/${k}" data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="pane">${loaded[c.id] && tab !== "files" ? "" : loadingHTML(tab === "files" ? "Loading files…" : "Loading course…")}</div>
  </div>`;
  if (tab === "files") {
    renderCourseFiles(c, hash);
    getDetail(c).then(d => { if (!d.modules?.length) document.querySelector('.tabs [data-tab="modules"]')?.remove(); }).catch(() => {});
    return;
  }
  let d;
  try { d = await getDetail(c); }
  catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
    if (location.hash === hash) $("pane").innerHTML = errorHTML(e);
    return;
  }
  if (location.hash !== hash) return; // moved on while loading
  // Courses that don't use modules don't get a Modules tab; their files live under Files.
  if (!d.modules?.length) {
    document.querySelector('.tabs [data-tab="modules"]')?.remove();
    if (tab === "modules") return location.replace(`#/course/${c.id}/files`);
  }
  $("pane").innerHTML = PANES[tab](c, d);
  if (tab === "grades") updateGrades(c, d);
  if (tab === "announcements") markAnnouncementsSeen(S.announcements.filter(a => a.courseId === c.id));
}

const assignmentRow = c => it => `<li>${rowLink(aLink(c.id, it.id), `
  <span class="type">${ICON[it.kind] || ICON.assignment}</span>
  <div><div class="rt">${esc(it.title)}</div><div class="meta">${esc(it.groupName)} · ${num(it.pts)} pts ${statusPill(it)}</div></div>
  ${it.score != null
    ? `<span class="score">${num(it.score)}/${num(it.pts)}<small>${it.pts ? Math.round(it.score / it.pts * 100) + "%" : ""}</small></span>`
    : `<span class="when ${!it.submitted && it.due && it.due > now && it.due - now < DAY ? "soon" : ""}">${fmtWhen(it.due)}</span>`}`)}</li>`;

const section = (label, items, render, emptyText, cls = "") => items.length
  ? `<div class="sub-h ${cls}">${label}</div><ul class="rows">${items.map(render).join("")}</ul>`
  : emptyText ? `<div class="sub-h">${label}</div><p class="empty">${emptyText}</p>` : "";

const PANES = {
  overview(c, d) {
    const items = allItems(d);
    const upcoming = items.filter(it => it.score == null && !it.excused && it.due && it.due >= startOfDay(now)).sort(byDue).slice(0, 5);
    const recent = items.filter(it => it.score != null).sort((a, b) => (b.gradedAt || b.due || 0) - (a.gradedAt || a.due || 0)).slice(0, 4);
    const anns = S.announcements.filter(a => a.courseId === c.id).slice(0, 4);
    const g = officialScore(c, d), max = calc(d, withRest).total;
    return `<div class="grid">
      <div class="stack">
        <section class="card"><div class="card-h"><h2>Up next</h2><a href="#/course/${c.id}/assignments">All assignments →</a></div>
          ${upcoming.length ? `<ul class="rows">${upcoming.map(assignmentRow(c)).join("")}</ul>` : `<p class="empty">Nothing coming up.</p>`}</section>
        <section class="card"><div class="card-h"><h2>Recently graded</h2><a href="#/course/${c.id}/grades">All grades →</a></div>
          ${recent.length ? `<ul class="rows">${recent.map(assignmentRow(c)).join("")}</ul>` : `<p class="empty">No grades yet.</p>`}</section>
      </div>
      <div class="stack">
        <section class="card gcard"><div class="card-h"><h2>Grade</h2><a href="#/course/${c.id}/grades">Details →</a></div>
          <div class="gbody">${c.hidden ? `<p class="meta">Your instructor has hidden the course total. You can still try what-if scores on the Grades tab.</p>` : `
            <div class="grade-row"><span class="grade big">${esc(c.letter || letterOf(g))}</span><span style="font-size:18px;font-weight:600">${g == null ? "No grades yet" : g.toFixed(1) + "%"}</span></div>
            <div class="bar"><i style="width:${Math.min(g ?? 0, 100)}%"></i></div>
            ${max != null ? `<div class="meta" style="margin-top:10px">Max possible: <b style="color:var(--text)">${max.toFixed(1)}%</b> if you get ${num(prefs.rest)}% on the rest</div>` : ""}`}
          </div></section>
        <section class="card"><div class="card-h"><h2>Announcements</h2></div>
          ${anns.length ? `<div class="ann full">${annHTML(anns)}</div>` : `<p class="empty">No recent announcements.</p>`}</section>
        <section class="card"><div class="card-h"><h2>Course info</h2></div>
          <div class="kv">
            ${c.teachers.length ? `<div><span>Instructor${c.teachers.length > 1 ? "s" : ""}</span><b>${esc(c.teachers.join(", "))}</b></div>` : ""}
            ${c.code ? `<div><span>Code</span>${esc(c.code)}</div>` : ""}
            ${c.term ? `<div><span>Term</span>${esc(c.term)}</div>` : ""}
            <div><span>Grading</span>${d.weighted ? "Weighted by category" : "Total points"}</div>
          </div></section>
      </div>
    </div>`;
  },

  assignments(c, d) {
    const items = allItems(d);
    const graded = items.filter(it => it.score != null || it.excused).sort((a, b) => (b.due || 0) - (a.due || 0));
    const open = items.filter(it => it.score == null && !it.excused);
    const upcoming = open.filter(it => !it.due || it.due >= now).sort(byDue);
    const past = open.filter(it => it.due && it.due < now).sort((a, b) => b.due - a.due);
    return `<section class="card">
      ${section("Upcoming", upcoming, assignmentRow(c), "Nothing upcoming.")}
      ${section("Past due, not graded yet", past, assignmentRow(c))}
      ${section("Graded", graded, assignmentRow(c), "Nothing graded yet.")}
    </section>`;
  },

  announcements(c) {
    return announcementsHTML(S.announcements.filter(a => a.courseId === c.id), false);
  },

  modules(c, d) {
    if (!d.modules?.length) return `<section class="card"><p class="empty" style="padding-top:20px">This course doesn't use modules, or they're turned off.${safeUrl(c.url) ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open it in Canvas ↗</a>` : ""}</p></section>`;
    let openIdx = d.modules.findIndex(m => m.items.some(i => i.done === false));
    if (openIdx < 0) openIdx = d.modules.length - 1;
    return `<section class="card">${d.modules.map((m, i) => {
      const req = m.items.filter(x => x.done != null);
      const prog = req.length ? `${req.filter(x => x.done).length}/${req.length} done` : `${m.items.length} item${m.items.length === 1 ? "" : "s"}`;
      return `<details class="mod" ${i === openIdx ? "open" : ""}>
        <summary>${ICON.chev}<span>${esc(m.name)}</span><span class="prog">${prog}</span></summary>
        <ul class="rows">${m.items.map(it => it.type === "SubHeader"
          ? `<li class="subhead">${esc(it.title)}</li>`
          : `<li>${rowLink(it.assignmentId ? aLink(c.id, it.assignmentId) : it.url, `<span class="type">${ICON[MODULE_ICON[it.type]] || ICON.page}</span><div>${esc(it.title)}</div><span>${it.done ? ICON.tick : ""}</span>`)}</li>`).join("")}</ul>
      </details>`;
    }).join("")}</section>`;
  },

  grades(c, d) {
    const items = allItems(d).filter(it => !it.omit);
    const ungraded = items.filter(it => it.score == null && !it.excused).sort(byDue);
    const graded = items.filter(it => it.score != null).sort((a, b) => (b.due || 0) - (a.due || 0));
    const wiRow = it => `<li class="${it.key in whatIf ? "changed" : ""}"><div class="row">
      <span class="type">${ICON[it.kind] || ICON.assignment}</span>
      <div><a class="rt plain" href="${aLink(c.id, it.id)}">${esc(it.title)}</a><div class="meta">${esc(it.groupName)} · ${it.score == null ? "due" : "submitted"} ${fmtWhen(it.due)}</div></div>
      <span class="score"><input type="number" class="wi" data-wi="${esc(it.key)}" data-actual="${it.score ?? ""}" min="0" step="any" value="${whatIf[it.key] ?? it.score ?? ""}" placeholder="–" aria-label="Score for ${esc(it.title)}"> / ${num(it.pts)}</span>
    </div></li>`;
    return `<div class="gstats">
      <div class="stat"><b id="gs-current"></b><span>current grade</span></div>
      <div class="stat"><b id="gs-whatif"></b><span>what-if grade <button class="link" id="wi-reset">reset</button></span></div>
      <div class="stat"><b id="gs-max"></b><span>max grade if you get <input type="number" class="wi" id="rest-x" min="0" step="any" value="${num(prefs.rest)}" aria-label="Percent on remaining work">% on the rest</span></div>
    </div>
    <div class="grid">
      <div class="stack">
        <section class="card"><div class="card-h"><h2>Upcoming</h2><span class="hint">Type a score to try a what-if</span></div>
          ${ungraded.length ? `<ul class="rows">${ungraded.map(wiRow).join("")}</ul>` : `<p class="empty">Nothing left to grade.</p>`}</section>
        <section class="card"><div class="card-h"><h2>Graded</h2><span class="hint">Change a score to try a what-if</span></div>
          ${graded.length ? `<ul class="rows">${graded.map(wiRow).join("")}</ul>` : `<p class="empty">Nothing graded yet.</p>`}</section>
      </div>
      <section class="card"><div class="card-h"><h2>Breakdown</h2></div><div class="weights" id="breakdown"></div></section>
    </div>
    <p class="footnote">What-if and max grades are estimates worked out here. Canvas's own number is the official one.</p>`;
  },
};

// Refreshes only the numbers on the Grades tab, so typing in a score box keeps focus.
function updateGrades(c, d) {
  const cur = calc(d, actual), wi = calc(d, withWhatIf), max = calc(d, withRest);
  const hasWI = allItems(d).some(it => it.key in whatIf);
  const fmt = (g, l) => g == null ? "–" : `${g.toFixed(1)}%<small>${esc(l || letterOf(g))}</small>`;
  $("gs-current").innerHTML = c.hidden ? "Hidden" : fmt(officialScore(c, d), c.letter);
  $("gs-whatif").innerHTML = hasWI ? fmt(wi.total) : "–";
  $("wi-reset").hidden = !hasWI;
  $("gs-max").innerHTML = fmt(max.total);
  $("breakdown").innerHTML = d.groups.map(g => {
    const p = cur.groups[g.id], q = hasWI ? wi.groups[g.id] : p;
    const changed = q != null && (p == null || p.toFixed(1) !== q.toFixed(1));
    const label = (p == null ? "No grades yet" : p.toFixed(1) + "%") + (changed ? ` → ${q.toFixed(1)}%` : "");
    return `<div><div class="w-top"><b>${esc(g.name)}</b><span>${label}${d.weighted ? ` · ${num(g.weight)}% of grade` : ""}</span></div><div class="bar"><i style="width:${Math.min(q ?? 0, 100)}%"></i></div></div>`;
  }).join("") || `<p class="meta">No assignment groups.</p>`;
}

// ---------- Assignment page ----------
async function renderAssignment(id, aid) {
  const c = byId[id];
  if (!c) return renderHome();
  const hash = location.hash;
  current = null;
  $("view").innerHTML = `<div style="--c:${cColor(c)}">
    <a href="#/course/${c.id}/assignments" class="back">← ${esc(cName(c))}</a>
    <div id="pane">${loadingHTML("Loading assignment…")}</div>
  </div>`;
  let a;
  try { a = await getAssignment(c, aid); }
  catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
    if (location.hash === hash) $("pane").innerHTML = errorHTML(e);
    return;
  }
  if (location.hash !== hash) return;
  current = { c, a };
  $("pane").innerHTML = assignmentHTML(c, a);
  renderSubmitCard();
}

function subStatus(a) {
  const s = a.sub;
  if (!s) return ["Not submitted", ""];
  if (s.excused) return ["Excused", ""];
  if (s.graded) return ["Graded", "ok"];
  if (s.submittedAt) return [s.late ? "Submitted late" : "Submitted", s.late ? "late" : "ok"];
  if (s.missing) return ["Missing", "late"];
  return ["Not submitted", ""];
}

function assignmentHTML(c, a) {
  const s = a.sub;
  const [statusText, statusCls] = subStatus(a);
  const kind = a.discussion ? "Discussion" : a.types.includes("online_quiz") ? "Quiz" : "Assignment";
  const types = a.types.map(t => TYPE_LABEL[t] || t).join(", ") || "Nothing online";
  const pct = s?.graded && a.pts ? s.score / a.pts * 100 : null;
  const st = a.stats;

  const facts = [
    ["Due", a.due ? fmtFull(a.due) : "No due date", a.due ? relDay(a.due) : ""],
    ["Points", num(a.pts), ""],
    ["Turn in", types, ""],
    a.attempts > 0 ? ["Attempts", `${s?.attempt || 0} of ${a.attempts} used`, ""] : null,
    a.lockAt ? ["Closes", fmtFull(a.lockAt), relDay(a.lockAt)] : null,
  ].filter(Boolean);

  // Which rating box to highlight: the one Canvas recorded, or else the level the points fall in
  // (each rating covers everything above the next one down).
  const ratingFor = r => {
    if (!r.got) return null;
    if (r.ratings.some(x => x.id === r.got.rating)) return r.got.rating;
    const above = r.ratings.filter(x => x.pts >= r.got.pts).sort((x, y) => x.pts - y.pts)[0];
    return above?.id ?? null;
  };
  const rubric = a.rubric?.length ? `<section class="card"><div class="card-h"><h2>Rubric</h2><span class="hint">${num(sum(a.rubric, r => r.pts))} pts total</span></div>
    <div class="rubric">${a.rubric.map(r => `<div class="crit">
      <div class="crit-h"><div><b>${esc(r.title)}</b>${r.long ? `<p>${esc(r.long)}</p>` : ""}</div><span class="score">${r.got ? `${num(r.got.pts)} / ` : ""}${num(r.pts)} pts</span></div>
      <div class="ratings">${r.ratings.map(x => `<div class="rating ${x.id === ratingFor(r) ? "on" : ""}"><b>${num(x.pts)}</b><span>${esc(x.title)}</span></div>`).join("")}</div>
      ${r.got?.comment ? `<p class="crit-note">“${esc(r.got.comment)}”</p>` : ""}
    </div>`).join("")}</div></section>` : "";

  const entry = e => `<article class="entry">
    <div class="meta"><b style="color:var(--text)">${esc(e.author)}</b> · ${ago(e.when)}</div>
    <div class="prose">${e.html}</div>
    ${e.replies.length ? `<div class="replies">${e.replies.map(entry).join("")}</div>` : ""}
  </article>`;
  const discussion = a.discussion ? `<section class="card"><div class="card-h"><h2>Discussion</h2>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open in Canvas ↗</a>` : ""}</div>
    ${a.discussion.entries === "locked" ? `<p class="empty">Post your reply first to see your classmates' posts.</p>`
      : !a.discussion.entries ? `<p class="empty">Couldn't load the replies.</p>`
      : a.discussion.entries.length ? `<div class="thread">${a.discussion.entries.map(entry).join("")}</div>` : `<p class="empty">No replies yet. You'd be first.</p>`}
  </section>` : "";

  return `
    <section class="card ahead">
      <div class="code">${esc(c.code)} · ${kind}</div>
      <h1>${esc(a.title)}</h1>
      <div class="facts">${facts.map(([k, v, small]) => `<div><span>${k}</span><b>${esc(v)}</b>${small ? `<small>${esc(small)}</small>` : ""}</div>`).join("")}</div>
      <button class="btn primary jump" data-action="jump-submit">${s?.graded ? "See your grade ↓" : a.discussion ? "Go to reply ↓" : "Go to turn in ↓"}</button>
    </section>
    <div class="grid agrid">
      <div class="stack">
        <section class="card"><div class="card-h"><h2>Instructions</h2>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open in Canvas ↗</a>` : ""}</div>
          ${a.html.trim() ? `<div class="prose pad">${a.html}</div>` : `<p class="empty">No instructions were posted.</p>`}</section>
        ${a.files.length ? `<section class="card"><div class="card-h"><h2>Attachments</h2><span class="hint">${a.files.length} file${a.files.length > 1 ? "s" : ""}</span></div><ul class="rows">${a.files.map(fileRow).join("")}</ul></section>` : ""}
        ${discussion}
        ${rubric}
      </div>
      <div class="stack">
        <section class="card"><div class="card-h"><h2>Your submission</h2><span class="pill ${statusCls}">${statusText}</span></div>
          <div class="gbody">
            ${s?.graded ? `<div class="grade-row"><span class="grade big">${num(s.score)}<small class="of">/${num(a.pts)}</small></span><span style="font-size:18px;font-weight:600">${pct == null ? "" : pct.toFixed(1) + "%"}</span></div>
              <div class="bar"><i style="width:${Math.min(pct ?? 0, 100)}%"></i></div>` : ""}
            ${st && (st.mean != null) ? `<div class="meta" style="margin-top:10px">Class: average ${num(st.mean)} · high ${num(st.max)} · low ${num(st.min)}</div>` : ""}
            ${s?.submittedAt ? `<div class="meta" style="margin-top:10px">Turned in ${fmtFull(s.submittedAt)}${s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}</div>` : !s?.graded ? `<p class="meta">Nothing turned in yet.</p>` : ""}
            ${s?.body ? `<div class="prose submitted">${s.body}</div>` : ""}
            ${s?.url ? `<p style="margin-top:10px"><a class="extlink" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)} ↗</a></p>` : ""}
          </div>
          ${s?.files.length ? `<ul class="rows">${s.files.map(fileRow).join("")}</ul>` : ""}
        </section>
        <section class="card" id="submit-card"></section>
        ${s?.comments.length ? `<section class="card"><div class="card-h"><h2>Comments</h2></div><div class="thread">${s.comments.map(cm => `<article class="entry">
          <div class="meta"><b style="color:var(--text)">${esc(cm.author)}</b> · ${ago(cm.when)}</div>
          <p class="comment">${esc(cm.text)}</p>
          ${cm.files.length ? `<ul class="rows tight">${cm.files.map(fileRow).join("")}</ul>` : ""}
        </article>`).join("")}</div></section>` : ""}
      </div>
    </div>`;
}

// The submit box. Re-rendered on its own so the rest of the page (and scroll) stays put.
function renderSubmitCard() {
  const el = $("submit-card");
  if (!el || !current) return;
  const { c, a } = current;
  const st = subState[a.id] ??= { type: a.discussion ? "discussion" : a.types.find(t => SUBMITTABLE.includes(t)) || null, files: [] };
  const used = a.sub?.attempt || 0;
  const head = title => `<div class="card-h"><h2>${title}</h2></div>`;
  const openBtn = label => a.url ? `<a class="btn primary" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : "";

  if (a.locked) {
    el.innerHTML = `${head("Turn in")}<div class="gbody"><p class="meta">${esc(a.lockText || "This assignment is locked, so it can't be turned in right now.")}</p></div>`;
    return;
  }
  if (!st.type) {
    const quiz = a.types.includes("online_quiz"), tool = a.types.includes("external_tool");
    const offline = a.types.every(t => ["none", "on_paper", "not_graded"].includes(t));
    el.innerHTML = `${head("Turn in")}<div class="gbody submit-off">
      <p class="meta">${quiz ? "Quizzes run in Canvas so the timer and question rules work properly." : tool ? "This one is done in an outside tool that only opens from Canvas." : offline ? "Nothing to turn in online for this one." : "This type of submission needs Canvas."}</p>
      ${!offline ? openBtn(quiz ? "Take the quiz in Canvas" : "Open in Canvas") : ""}
    </div>`;
    return;
  }
  if (st.type !== "discussion" && a.attempts > 0 && used >= a.attempts) {
    el.innerHTML = `${head("Turn in")}<div class="gbody"><p class="meta">You've used all ${a.attempts} attempt${a.attempts > 1 ? "s" : ""}.</p></div>`;
    return;
  }

  const draft = store.get(`draft:${a.id}:${st.type}`) || "";
  const choices = a.types.filter(t => SUBMITTABLE.includes(t));
  const late = a.due && a.due < now;
  const form = {
    discussion: `<textarea class="area" id="sub-text" rows="7" placeholder="Write your reply…">${esc(draft)}</textarea>`,
    online_text_entry: `<textarea class="area" id="sub-text" rows="10" placeholder="Write your answer…">${esc(draft)}</textarea>
      <div class="hint">Blank lines start a new paragraph.</div>`,
    online_url: `<input type="url" class="area" id="sub-url" placeholder="https://…" value="${esc(draft)}">`,
    online_upload: `<label class="drop" id="drop">
        <input type="file" id="sub-files" multiple ${a.ext.length ? `accept="${esc(a.ext.map(x => "." + x).join(","))}"` : ""}>
        ${ICON.upload}<b>Drop files here or click to choose</b>
        <span class="meta">${a.ext.length ? `Allowed: ${esc(a.ext.map(x => "." + x).join(", "))}` : "Any file type"}</span>
      </label>
      ${st.files.length ? `<ul class="rows tight">${st.files.map((f, i) => `<li><div class="row"><span class="type">${ICON.file}</span><div><div class="rt">${esc(f.name)}</div><div class="meta">${fmtSize(f.size)}</div></div><button class="icon-btn" data-remove-file="${i}" aria-label="Remove ${esc(f.name)}">✕</button></div></li>`).join("")}</ul>` : ""}`,
  }[st.type];

  el.innerHTML = `${head(st.type === "discussion" ? "Reply" : used ? "Turn in again" : "Turn in")}
    <div class="gbody submit">
      ${choices.length > 1 && st.type !== "discussion" ? `<div class="seg" style="grid-template-columns:repeat(${choices.length},1fr)">${choices.map(t => `<button data-subtype="${t}" class="${t === st.type ? "on" : ""}">${TYPE_LABEL[t]}</button>`).join("")}</div>` : ""}
      ${form}
      ${late && st.type !== "discussion" ? `<p class="meta warn-text">It's past the due date, so Canvas will mark this late.</p>` : ""}
      ${used && st.type !== "discussion" ? `<p class="meta">This becomes attempt ${used + 1}${a.attempts > 0 ? ` of ${a.attempts}` : ""}. Your teacher sees your latest one.</p>` : ""}
      <div class="progress" id="sub-progress" hidden><i></i></div>
      <p class="meta" id="sub-status"></p>
      <p class="login-err" id="sub-err" role="alert"></p>
      <button class="btn primary" data-action="submit">${st.type === "discussion" ? "Post reply" : "Submit"}</button>
    </div>`;
}

// Plain text from the box, turned into simple paragraphs for Canvas.
const textToHTML = t => t.trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

function addFiles(list) {
  const { a } = current, st = subState[a.id];
  const bad = [];
  for (const f of list) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (a.ext.length && !a.ext.includes(ext)) bad.push(f.name);
    else st.files.push(f);
  }
  renderSubmitCard();
  if (bad.length) $("sub-err").textContent = `Not allowed for this assignment: ${bad.join(", ")}`;
}

async function startSubmit() {
  const { c, a } = current, st = subState[a.id];
  const err = msg => { $("sub-err").textContent = msg; };
  let payload, summary;
  if (st.type === "discussion" || st.type === "online_text_entry") {
    const text = $("sub-text").value;
    if (!text.trim()) return err("Write something first.");
    const words = text.trim().split(/\s+/).length;
    payload = { html: textToHTML(text) };
    summary = `<p class="meta">${words} word${words > 1 ? "s" : ""}</p><blockquote class="preview">${esc(text.trim().slice(0, 400))}${text.trim().length > 400 ? "…" : ""}</blockquote>`;
  } else if (st.type === "online_url") {
    let url = $("sub-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    try { if (!url || !/^https?:$/.test(new URL(url).protocol)) throw 0; } catch { return err("That doesn't look like a web address."); }
    payload = { url };
    summary = `<p class="preview">${esc(url)}</p>`;
  } else {
    if (!st.files.length) return err("Choose at least one file.");
    payload = { files: st.files };
    summary = `<ul class="plain">${st.files.map(f => `<li>${esc(f.name)} <span class="meta">${fmtSize(f.size)}</span></li>`).join("")}</ul>`;
  }

  const isReply = st.type === "discussion";
  const ok = await askConfirm({
    title: isReply ? "Post this reply?" : `Turn in “${a.title}”?`,
    html: `<p>${isReply ? `Everyone in <b>${esc(cName(c))}</b> will be able to see it.` : `This goes to your teacher in <b>${esc(cName(c))}</b> as ${esc(TYPE_LABEL[st.type].toLowerCase())}.`}</p>${summary}`,
    yes: isReply ? "Post reply" : "Submit",
  });
  if (!ok) return;

  const btn = document.querySelector('[data-action="submit"]'), bar = $("sub-progress");
  btn.disabled = true; btn.textContent = isReply ? "Posting…" : "Submitting…";
  err("");
  const progress = (p, label) => { bar.hidden = false; bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; if (label) $("sub-status").textContent = label; };
  try {
    await source().submit(c, a, st.type, payload, progress);
  } catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
    btn.disabled = false; btn.textContent = isReply ? "Post reply" : "Submit";
    bar.hidden = true; $("sub-status").textContent = "";
    return err(`${isReply ? "Couldn't post" : "Couldn't submit"}: ${e.detail || (e.status === "network" ? "the connection dropped" : `Canvas returned ${e.status}`)}. Nothing was turned in${st.type === "online_upload" ? " (files may have uploaded, but they aren't submitted)" : ""}.`);
  }

  // Forget the draft, refresh what we know about this assignment and course.
  store.del(`draft:${a.id}:${st.type}`);
  delete subState[a.id];
  delete assignmentsCache[`${c.id}/${a.id}`];
  delete details[c.id]; delete loaded[c.id];
  S.planner.filter(p => p.assignmentId === a.id).forEach(p => { p.submitted = true; p.missing = false; });
  toast(isReply ? "Reply posted" : `Turned in at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  route();
}

// ---------- Confirm dialog and toast ----------
function askConfirm({ title, html, yes }) {
  return new Promise(resolve => {
    $("confirm-title").textContent = title;
    $("confirm-body").innerHTML = html;
    $("confirm-yes").textContent = yes;
    $("confirm").hidden = false;
    $("confirm-yes").focus();
    const close = answer => { $("confirm").hidden = true; $("confirm-yes").onclick = $("confirm-no").onclick = null; resolve(answer); };
    $("confirm-yes").onclick = () => close(true);
    $("confirm-no").onclick = () => close(false);
  });
}
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- Shell, routing ----------
function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty("--accent", safeColor(prefs.accent) || DEFAULTS.accent);
  if (prefs.theme === "system") delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  const site = prefs.site.trim() || DEFAULTS.site;
  document.title = site;
  $("brand").textContent = $("login-brand").textContent = site;
  if (S) { $("avatar").textContent = initials(); $("foot-name").textContent = firstName(); }
}

function route() {
  if (!S) return;
  now = new Date();
  const [, page, id, tab, sub] = location.hash.replace(/^#/, "").split("/");
  $("side-courses").innerHTML = S.courses.map(c => `<a href="#/course/${c.id}" class="course-link ${page === "course" && id === c.id ? "on" : ""}"><span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))}</a>`).join("");
  const nav = ["todo", "grades", "calendar", "inbox", "files", "announcements"].includes(page) ? page : page === "course" ? "" : "home";
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === nav));
  $("nav-more").classList.toggle("on", ["grades", "files", "announcements"].includes(nav));
  $("more-menu").hidden = true;
  updateBadges();
  if (page === "course" && tab === "a" && sub) renderAssignment(id, sub);
  else if (page === "course") renderCourse(id, tab);
  else if (page === "todo") renderTodo();
  else if (page === "grades") renderGrades();
  else if (page === "calendar") renderCalendar();
  else if (page === "inbox") renderInbox(id);
  else if (page === "files") renderFiles();
  else if (page === "announcements") renderAnnouncements();
  else renderHome();
}

async function boot() {
  applyPrefs();
  if (!session) return showLogin();
  $("login").hidden = true;
  $("app").hidden = false;
  $("view").innerHTML = loadingHTML("Loading your courses…");
  try {
    S = await source().loadAll();
  } catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token. It may have expired or been deleted.");
    $("view").innerHTML = errorHTML(e);
    return;
  }
  byId = Object.fromEntries(S.courses.map(c => [c.id, c]));
  applyPrefs();
  route();
  refreshUnread();
}

function signOut(message = "") {
  store.del("session");
  session = null; S = null; byId = {}; current = null;
  for (const o of [details, loaded, assignmentsCache, whatIf, subState]) for (const k in o) delete o[k];
  resetViews();
  document.body.classList.remove("customizing");
  $("confirm").hidden = true;
  history.replaceState(null, "", location.pathname);
  showLogin(message);
}

// ---------- Sign-in ----------
function showLogin(message = "") {
  $("app").hidden = true;
  $("login").hidden = false;
  $("l-err").textContent = message;
  $("l-token").value = "";
  $("l-submit").disabled = false;
  $("l-submit").textContent = "Sign in";
}
const normHost = v => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");

$("l-host").addEventListener("input", e => {
  const h = normHost(e.target.value);
  $("l-settings").href = /^[a-z0-9-]+\.instructure\.com$/.test(h) ? `https://${h}/profile/settings` : "#";
});
$("l-show").onclick = () => {
  const t = $("l-token");
  t.type = t.type === "password" ? "text" : "password";
  $("l-show").setAttribute("aria-label", t.type === "password" ? "Show token" : "Hide token");
};
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const host = normHost($("l-host").value), token = $("l-token").value.trim();
  const fail = msg => { $("l-err").textContent = msg; $("l-submit").disabled = false; $("l-submit").textContent = "Sign in"; };
  if (!/^[a-z0-9-]+\.instructure\.com$/.test(host)) return fail("Use your school's .instructure.com address, like floridapolytechnic.instructure.com.");
  if (!token) return fail("Paste your access token first.");
  $("l-err").textContent = "";
  $("l-submit").disabled = true;
  $("l-submit").textContent = "Checking with Canvas…";
  try {
    await Canvas.get("users/self", {}, false, { host, token });
  } catch (err) {
    return fail(err instanceof AuthError ? "Canvas didn't accept that token. Check you copied all of it." : err.status === 404 ? "Couldn't find a Canvas site at that address." : "Couldn't reach Canvas. Check the address and try again.");
  }
  session = { host, token };
  store.set("session", session, $("l-remember").checked);
  $("l-token").value = "";
  location.hash = "#/";
  boot();
});
$("l-demo").onclick = () => { session = { demo: true }; store.set("session", session, false); location.hash = "#/"; boot(); };
$("sign-out").onclick = () => signOut();

// ---------- Interactions ----------
$("view").addEventListener("click", e => {
  const t = e.target;
  if (t.closest('[data-action="retry"]')) return S ? route() : boot();
  if (t.closest('[data-action="submit"]')) return startSubmit();
  if (t.closest('[data-action="jump-submit"]')) {
    const target = current?.a.sub?.graded ? document.querySelector(".agrid > .stack:last-child") : $("submit-card");
    return target?.scrollIntoView({ behavior: "smooth" });
  }
  const typeBtn = t.closest("[data-subtype]");
  if (typeBtn && current) { subState[current.a.id].type = typeBtn.dataset.subtype; return renderSubmitCard(); }
  const rm = t.closest("[data-remove-file]");
  if (rm && current) { subState[current.a.id].files.splice(+rm.dataset.removeFile, 1); return renderSubmitCard(); }
  if (t.id === "wi-reset") { const c = courseInView(); allItems(loaded[c.id]).forEach(it => delete whatIf[it.key]); return route(); }
  const btn = t.closest(".check");
  if (!btn) return;
  const key = btn.closest("li").dataset.key, p = S.planner.find(x => x.key === key);
  if (!p) return;
  const next = !isDone(p);
  if (next === p.submitted) delete done[key]; else done[key] = next;
  store.set("done", done);
  route();
});
$("view").addEventListener("input", e => {
  const t = e.target;
  // Drafts are kept in this browser so a reload doesn't lose an answer.
  if ((t.id === "sub-text" || t.id === "sub-url") && current) {
    const key = `draft:${current.a.id}:${subState[current.a.id].type}`;
    t.value ? store.set(key, t.value) : store.del(key);
    return;
  }
  const c = courseInView(), d = c && loaded[c.id];
  if (!d) return;
  if (t.dataset.wi) {
    const n = parseFloat(t.value);
    // Blank, or typed back to the real score, means no what-if for that item.
    if (t.value === "" || isNaN(n) || (t.dataset.actual !== "" && n === +t.dataset.actual)) delete whatIf[t.dataset.wi];
    else whatIf[t.dataset.wi] = n;
    t.closest("li").classList.toggle("changed", t.dataset.wi in whatIf);
  }
  if (t.id === "rest-x") { const n = parseFloat(t.value); if (!isNaN(n) && n >= 0) { prefs.rest = n; savePrefs(); } }
  updateGrades(c, d);
});
$("view").addEventListener("change", e => {
  if (e.target.id === "sub-files" && current) { addFiles([...e.target.files]); }
});
$("view").addEventListener("dragover", e => { const d = e.target.closest("#drop"); if (d) { e.preventDefault(); d.classList.add("over"); } });
$("view").addEventListener("dragleave", e => { e.target.closest("#drop")?.classList.remove("over"); });
$("view").addEventListener("drop", e => {
  if (!e.target.closest("#drop") || !current) return;
  e.preventDefault();
  addFiles([...e.dataTransfer.files]);
});
window.addEventListener("hashchange", () => { route(); scrollTo(0, 0); });

$("theme").onclick = () => {
  const dark = prefs.theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : prefs.theme === "dark";
  prefs.theme = dark ? "light" : "dark"; savePrefs(); applyPrefs(); fillPanel();
};

// ---------- Customize panel ----------
function fillPanel() {
  $("f-site").value = prefs.site;
  $("f-name").value = prefs.name;
  $("f-name").placeholder = S?.user.name || "";
  $("f-accent").innerHTML = ACCENTS.map(a => `<button class="swatch ${a === prefs.accent ? "on" : ""}" style="background:${a}" data-v="${a}" aria-label="Accent ${a}"></button>`).join("");
  $("f-theme").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === prefs.theme));
  $("f-courses").innerHTML = (S?.courses || []).map(c => `<div class="c-row">
    <input type="color" value="${cColor(c).length === 7 ? cColor(c) : "#3b5bdb"}" data-color="${esc(c.id)}" aria-label="${esc(c.code)} color">
    <div class="field"><input type="text" value="${esc(cName(c))}" placeholder="${esc(c.name)}" data-nick="${esc(c.id)}" aria-label="${esc(c.code)} name"></div>
  </div>`).join("");
}
const refresh = () => { savePrefs(); applyPrefs(); route(); };

$("open-custom").onclick = () => { fillPanel(); document.body.classList.add("customizing"); };
$("close-custom").onclick = $("scrim").onclick = () => document.body.classList.remove("customizing");
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  document.body.classList.remove("customizing");
  if (!$("confirm").hidden) $("confirm-no").click();
});
$("f-site").oninput = e => { prefs.site = e.target.value; refresh(); };
$("f-name").oninput = e => { prefs.name = e.target.value; refresh(); };
$("f-accent").onclick = e => { const b = e.target.closest(".swatch"); if (!b) return; prefs.accent = b.dataset.v; refresh(); fillPanel(); };
$("f-theme").onclick = e => { const b = e.target.closest("button"); if (!b) return; prefs.theme = b.dataset.v; refresh(); fillPanel(); };
$("f-courses").oninput = e => {
  const t = e.target;
  if (t.dataset.color) prefs.colors[t.dataset.color] = t.value;
  if (t.dataset.nick) { const c = byId[t.dataset.nick]; t.value.trim() && t.value !== c.name ? prefs.nick[c.id] = t.value : delete prefs.nick[c.id]; }
  refresh();
};
$("f-reset").onclick = () => { prefs = { ...DEFAULTS, nick: {}, colors: {}, calHidden: [] }; refresh(); fillPanel(); };

// boot() runs at the end of views.js, once every page is defined.
