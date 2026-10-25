"use strict";
// Files: a Files tab in each course, an all-files page, and an in-app viewer.

// ---------- Canvas ----------
Object.assign(Canvas, {
  async loadCourseFiles(c) {
    const [folders, files] = await Promise.all([
      this.get(`courses/${c.id}/folders`, { per_page: 100 }, true),
      this.get(`courses/${c.id}/files`, { per_page: 100, sort: "updated_at", order: "desc" }, true),
    ]);
    const root = folders.find(f => !f.parent_folder_id);
    return {
      rootId: root ? String(root.id) : null,
      folders: folders.filter(f => !f.hidden_for_user).map(f => ({
        id: String(f.id), name: f.name, parentId: f.parent_folder_id ? String(f.parent_folder_id) : null,
        path: (f.full_name || "").replace(/^course files\/?/, ""),
      })),
      files: files.map(f => ({
        id: String(f.id), name: f.display_name || f.filename, size: f.size, type: f["content-type"] || "",
        url: safeUrl(f.url), updated: new Date(f.updated_at || f.created_at), folderId: String(f.folder_id),
        courseId: c.id, locked: !!f.locked_for_user,
      })),
    };
  },
});

// ---------- Fetching file contents ----------
// Canvas file links point at Canvas, which browsers can't read cross-site, so downloads for
// previews go through /filedl/ on our own domain (see the nginx config).
function fileProxyUrl(url) {
  try {
    const u = new URL(url);
    if (!/^[a-z0-9-]+\.instructure\.com$/.test(u.host)) return null;
    if (!/^\/(?:courses\/[0-9~]+\/)?files\/[0-9~]+\/download$/.test(u.pathname)) return null;
    return `/filedl/${u.host}${u.pathname}${u.search}`;
  } catch { return null; }
}

async function fetchFileBlob(f) {
  if (f.demoText != null) return new Blob([f.demoText], { type: f.type || "text/plain" });
  const proxied = f.url && fileProxyUrl(f.url);
  if (!proxied) throw new Error(session?.demo ? "This is a sample file, so there's nothing to preview." : "This file can't be opened here. Use Download instead.");
  const res = await fetch(proxied, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 404 ? "Canvas couldn't find this file." : `Canvas returned ${res.status} for this file.`);
  const blob = await res.blob();
  // An expired or bad link gets Canvas's login page instead of the file.
  if (blob.type.startsWith("text/html") && !["html", "htm"].includes(extOf(f.name))) throw new Error("Canvas wouldn't hand over this file. Try Download instead.");
  return blob.type || !f.type ? blob : new Blob([blob], { type: f.type });
}

// Text out of .docx / .pptx files: they're zip archives of XML. Reads the zip's directory,
// inflates the parts we need with the browser's built-in DecompressionStream.
async function unzip(buffer, wanted) {
  const v = new DataView(buffer), out = {};
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That file looks damaged.");
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true), dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true), name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = new Uint8Array(buffer, start, size);
    out[name] = method === 0 ? dec.decode(raw)
      : method === 8 ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text()
      : "";
  }
  return out;
}
const xmlText = xml => new DOMParser().parseFromString(xml.replace(/<w:tab\/>/g, "\t").replace(/<\/(w|a):p>/g, "\n").replace(/<[^>]+>/g, ""), "text/html").documentElement.textContent;

async function officeText(blob, ext) {
  const buf = await blob.arrayBuffer();
  if (ext === "docx") {
    const parts = await unzip(buf, n => n === "word/document.xml");
    return xmlText(parts["word/document.xml"] || "").replace(/\n{3,}/g, "\n\n").trim();
  }
  const parts = await unzip(buf, n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return Object.keys(parts).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))
    .map((k, i) => `--- Slide ${i + 1} ---\n${xmlText(parts[k]).trim()}`).join("\n\n");
}

// ---------- File types ----------
const extOf = name => (String(name).split(".").pop() || "").toLowerCase();
const TEXT_EXT = ["txt", "md", "csv", "tsv", "json", "xml", "html", "htm", "css", "js", "ts", "py", "java", "c", "cpp", "h", "hpp", "cs", "rb", "go", "rs", "m", "r", "sql", "sh", "yaml", "yml", "tex", "log", "ini"];
function fileKind(f) {
  const t = f.type || "", e = extOf(f.name);
  if (t === "application/pdf" || e === "pdf") return "pdf";
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "image";
  if (t.startsWith("video/") || ["mp4", "mov", "webm", "m4v"].includes(e)) return "video";
  if (t.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg"].includes(e)) return "audio";
  if (["doc", "docx", "odt", "rtf", "pages"].includes(e)) return "doc";
  if (["ppt", "pptx", "odp", "key"].includes(e)) return "slides";
  if (["xls", "xlsx", "ods", "numbers"].includes(e)) return "sheet";
  if (t.startsWith("text/") || TEXT_EXT.includes(e)) return "text";
  if (["zip", "rar", "7z", "gz", "tar"].includes(e)) return "archive";
  return "other";
}
const KIND_LABEL = { pdf: "PDF", image: "Image", video: "Video", audio: "Audio", doc: "Document", slides: "Slides", sheet: "Spreadsheet", text: "Text", archive: "Archive", other: "File" };
const FILTERS = [["", "All types"], ["pdf", "PDFs"], ["doc", "Documents"], ["slides", "Slides"], ["image", "Images"], ["video", "Video"], ["other", "Other"]];
const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

// Every file we've shown, so the viewer can find one by id.
const FILES = {};
const remember = f => (FILES[f.id] = f);

// ---------- Loading ----------
const courseFiles = {};   // course id -> promise
const getCourseFiles = c => courseFiles[c.id] ??= source().loadCourseFiles(c)
  .then(d => { d.files.forEach(remember); return d; })
  .catch(e => { delete courseFiles[c.id]; throw e; });

const filesOff = e => e?.status === 401 || e?.status === 403 || e?.status === 404;
const fileState = { q: "", kind: "", course: "", sort: "new", folder: {} };   // folder: course id -> folder id

function filterFiles(list) {
  const q = fileState.q.trim().toLowerCase();
  const out = list.filter(f => (!q || f.name.toLowerCase().includes(q)) && (!fileState.kind || (fileState.kind === "other" ? !["pdf", "doc", "slides", "image", "video"].includes(fileKind(f)) : fileKind(f) === fileState.kind)));
  const by = { new: (a, b) => b.updated - a.updated, name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => (b.size || 0) - (a.size || 0) }[fileState.sort];
  return out.sort(by);
}

function fileItem(f, { showCourse = false, folderPath = "" } = {}) {
  remember(f);
  const c = byId[f.courseId];
  const meta = [showCourse && c ? esc(cName(c)) : "", folderPath ? esc(folderPath) : "", fmtSize(f.size), f.updated ? fmtWhen(f.updated) : ""].filter(Boolean).join(" · ");
  return `<li><button class="row frow" data-view-file="${esc(f.id)}" ${f.locked ? "disabled" : ""}>
    <span class="type kind-${fileKind(f)}" style="--c:${c ? cColor(c) : "var(--accent)"}">${f.locked ? LOCK_ICON : ICON.file}</span>
    <div><div class="rt">${esc(f.name)}</div><div class="meta">${meta}${f.locked ? " · Locked" : ""}</div></div>
    <span class="pill">${KIND_LABEL[fileKind(f)]}</span>
  </button></li>`;
}

const toolbar = (withCourses) => `<div class="ftools">
    <input type="search" class="area" id="file-q" placeholder="Search files…" value="${esc(fileState.q)}" aria-label="Search files">
    <select class="area sel" id="file-kind" aria-label="File type">${FILTERS.map(([k, l]) => `<option value="${k}" ${fileState.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select class="area sel" id="file-sort" aria-label="Sort">${[["new", "Newest"], ["name", "Name"], ["size", "Largest"]].map(([k, l]) => `<option value="${k}" ${fileState.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
  </div>
  ${withCourses ? `<div class="filters">
    <button class="fchip ${!fileState.course ? "on" : ""}" data-file-course="">All classes</button>
    ${S.courses.map(c => `<button class="fchip ${fileState.course === c.id ? "on" : ""}" data-file-course="${esc(c.id)}"><span class="dot" style="background:${cColor(c)}"></span>${esc(cName(c))}</button>`).join("")}
  </div>` : ""}`;

// ---------- All files page ----------
async function renderFiles() {
  const hash = location.hash;
  $("view").innerHTML = `
    <header class="hello"><div><h1>Files</h1><p id="files-sub">Everything your classes have shared.</p></div></header>
    <section class="card">${toolbar(true)}<div id="files-list">${loadingHTML("Gathering files from your classes…")}</div></section>`;
  const results = await Promise.allSettled(S.courses.map(c => getCourseFiles(c).then(d => ({ c, d }))));
  if (location.hash !== hash) return;
  if (results.some(r => r.status === "rejected" && r.reason instanceof AuthError)) return signOut("Canvas didn't accept your token anymore. Sign in again.");
  drawAllFiles(results);
  renderFiles.last = results;
}

function drawAllFiles(results = renderFiles.last) {
  if (!results || !$("files-list")) return;
  const ok = results.filter(r => r.status === "fulfilled").map(r => r.value);
  const off = results.filter(r => r.status === "rejected").length;
  const paths = {};
  for (const { d } of ok) for (const fo of d.folders) paths[fo.id] = fo.path;
  const all = ok.flatMap(({ d }) => d.files).filter(f => !fileState.course || f.courseId === fileState.course);
  const list = filterFiles(all);
  $("files-sub").textContent = `${all.length} file${all.length === 1 ? "" : "s"}${fileState.course ? ` in ${cName(byId[fileState.course])}` : " across your classes"}${off ? ` · ${off} class${off > 1 ? "es have" : " has"} files turned off` : ""}`;
  $("files-list").innerHTML = list.length
    ? `<ul class="rows">${list.slice(0, 400).map(f => fileItem(f, { showCourse: !fileState.course, folderPath: paths[f.folderId] })).join("")}</ul>${list.length > 400 ? `<p class="empty">Showing the first 400. Search to narrow it down.</p>` : ""}`
    : `<p class="empty">${all.length ? "No files match that." : "No files shared yet."}</p>`;
}

// ---------- Course files tab ----------
async function renderCourseFiles(c, hash) {
  let d;
  try { d = await getCourseFiles(c); }
  catch (e) {
    if (e instanceof AuthError) return signOut("Canvas didn't accept your token anymore. Sign in again.");
    if (location.hash !== hash) return;
    $("pane").innerHTML = filesOff(e)
      ? `<section class="card"><p class="empty" style="padding-top:20px">Files are turned off for this course. Your teacher may share files through Modules instead.</p></section>`
      : errorHTML(e);
    return;
  }
  if (location.hash !== hash) return;
  $("pane").innerHTML = `<section class="card">${toolbar(false)}<div id="cfiles"></div></section>`;
  drawCourseFiles(c, d);
}

function drawCourseFiles(c, d) {
  const el = $("cfiles");
  if (!el) return;
  const searching = fileState.q.trim() || fileState.kind;
  const paths = Object.fromEntries(d.folders.map(f => [f.id, f.path]));
  if (searching) {
    const list = filterFiles(d.files);
    el.innerHTML = list.length ? `<ul class="rows">${list.map(f => fileItem(f, { folderPath: paths[f.folderId] })).join("")}</ul>` : `<p class="empty">No files match that.</p>`;
    return;
  }
  const here = fileState.folder[c.id] || d.rootId;
  const trail = [];
  for (let f = d.folders.find(x => x.id === here); f; f = d.folders.find(x => x.id === f.parentId)) trail.unshift(f);
  const sub = d.folders.filter(f => f.parentId === here).sort((a, b) => a.name.localeCompare(b.name));
  const files = filterFiles(d.files.filter(f => f.folderId === here));
  const count = id => d.files.filter(f => f.folderId === id).length + d.folders.filter(f => f.parentId === id).length;
  el.innerHTML = `
    <nav class="crumbs">${trail.map((f, i) => i === trail.length - 1 ? `<b>${i ? esc(f.name) : "All files"}</b>` : `<button data-folder="${esc(f.id)}">${i ? esc(f.name) : "All files"}</button><span>/</span>`).join("")}</nav>
    ${sub.length || files.length ? `<ul class="rows">
      ${sub.map(f => `<li><button class="row frow" data-folder="${esc(f.id)}"><span class="type folder">${FOLDER_ICON}</span><div><div class="rt">${esc(f.name)}</div><div class="meta">${count(f.id)} item${count(f.id) === 1 ? "" : "s"}</div></div><span class="meta">›</span></button></li>`).join("")}
      ${files.map(f => fileItem(f)).join("")}
    </ul>` : `<p class="empty">This folder is empty.</p>`}`;
}
const courseFilesView = () => { const c = courseInView(); return c && courseFiles[c.id] ? { c } : null; };

// ---------- Viewer ----------
let viewerUrl = null;
async function viewFile(id) {
  const f = FILES[id];
  if (!f) return;
  const c = byId[f.courseId], kind = fileKind(f);
  $("viewer-title").textContent = f.name;
  $("viewer-meta").textContent = [c ? cName(c) : "", KIND_LABEL[kind], fmtSize(f.size)].filter(Boolean).join(" · ");
  $("viewer-dl").hidden = !f.url;
  if (f.url) $("viewer-dl").href = f.url;
  $("viewer-body").innerHTML = loadingHTML("Opening…");
  $("viewer").hidden = false;
  document.body.classList.add("no-scroll");

  const show = html => { if ($("viewer-title").textContent === f.name) $("viewer-body").innerHTML = html; };
  const noPreview = msg => show(`<div class="viewer-empty">${ICON.file}<p>${esc(msg)}</p>${f.url ? `<a class="btn primary" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Download</a>` : ""}</div>`);
  const previewable = ["pdf", "image", "video", "audio", "text"].includes(kind) || ["docx", "pptx"].includes(extOf(f.name));
  if (!previewable) return noPreview(`There's no preview for ${KIND_LABEL[kind].toLowerCase()} files. Download it to open it.`);
  if ((f.size || 0) > 60e6) return noPreview("This file is too big to preview here.");
  try {
    const blob = await fetchFileBlob(f);
    if ($("viewer").hidden) return;
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = URL.createObjectURL(blob);
    if (kind === "pdf") show(`<iframe src="${viewerUrl}" title="${esc(f.name)}"></iframe>`);
    else if (kind === "image") show(`<div class="viewer-img"><img src="${viewerUrl}" alt="${esc(f.name)}"></div>`);
    else if (kind === "video") show(`<video src="${viewerUrl}" controls playsinline></video>`);
    else if (kind === "audio") show(`<div class="viewer-empty"><audio src="${viewerUrl}" controls></audio></div>`);
    else if (["docx", "pptx"].includes(extOf(f.name))) show(`<p class="viewer-note">Text-only preview. Download for the full formatting.</p><pre class="viewer-text">${esc(await officeText(blob, extOf(f.name)))}</pre>`);
    else show(`<pre class="viewer-text">${esc((await blob.text()).slice(0, 500000))}</pre>`);
  } catch (e) {
    noPreview(e.message || "Couldn't open this file.");
  }
}

function closeViewer() {
  $("viewer").hidden = true;
  $("viewer-body").innerHTML = "";
  document.body.classList.remove("no-scroll");
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
}

// ---------- Events ----------
document.addEventListener("click", e => {
  const t = e.target;
  const fv = t.closest("[data-view-file]");
  if (fv) { e.preventDefault(); return viewFile(fv.dataset.viewFile); }
  if (t.closest("#viewer-close") || t.id === "viewer") return closeViewer();
  const fc = t.closest("[data-file-course]");
  if (fc) { fileState.course = fc.dataset.fileCourse; document.querySelectorAll("[data-file-course]").forEach(b => b.classList.toggle("on", b === fc)); return drawAllFiles(); }
  const fo = t.closest("[data-folder]");
  if (fo) { const c = courseInView(); fileState.folder[c.id] = fo.dataset.folder; return courseFiles[c.id].then(d => drawCourseFiles(c, d)); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("viewer").hidden) closeViewer(); });

function redrawFiles() {
  if (location.hash.startsWith("#/files")) return drawAllFiles();
  const v = courseFilesView();
  if (v) courseFiles[v.c.id].then(d => drawCourseFiles(v.c, d));
}
$("view").addEventListener("input", e => { if (e.target.id === "file-q") { fileState.q = e.target.value; redrawFiles(); } });
$("view").addEventListener("change", e => {
  if (e.target.id === "file-kind") { fileState.kind = e.target.value; redrawFiles(); }
  if (e.target.id === "file-sort") { fileState.sort = e.target.value; redrawFiles(); }
});
