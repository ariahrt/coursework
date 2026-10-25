"use strict";
// Sample data for "look around with sample data". Same shape the Canvas loader returns.
window.DEMO = (() => {
  const DAY = 864e5, now = new Date();
  const at = (days, h = 23, m = 59) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
  const kind = t => /quiz|exam|midterm/i.test(t) ? "quiz" : /discussion/i.test(t) ? "discussion" : "assignment";

  const COURSES = [
    { id: "1", code: "MAC 2312", name: "Calculus II", color: "#3b5bdb", teachers: ["Dr. Elena Ruiz"],
      groups: [["Homework", 20], ["Quizzes", 20], ["Exams", 60]],
      topics: ["Integration by Parts", "Trig Integrals & Substitution", "Improper Integrals", "Sequences", "Series & Convergence Tests"],
      graded: [["WebAssign 7.1", "Homework", 20, 19, 30], ["Quiz 4", "Quizzes", 10, 9, 26], ["WebAssign 7.4", "Homework", 20, 20, 22], ["Exam 2", "Exams", 100, 88, 12], ["Quiz 5", "Quizzes", 10, 8, 8], ["WebAssign 8.1", "Homework", 20, 18, 4]] },
    { id: "2", code: "COP 3337", name: "Programming II", color: "#2b8a3e", teachers: ["Prof. Daniel Okafor"],
      groups: [["Labs", 25], ["Projects", 45], ["Exams", 30]],
      topics: ["Classes & Encapsulation", "Inheritance", "Recursion", "Dynamic Memory", "Linked Lists"],
      graded: [["Lab 5: Recursion", "Labs", 10, 10, 27], ["Project 2: Inventory", "Projects", 100, 97, 20], ["Lab 6: Pointers", "Labs", 10, 10, 13], ["Midterm", "Exams", 100, 94, 9], ["Lab 7: Nodes", "Labs", 10, 9, 5]] },
    { id: "3", code: "PHY 2048", name: "Physics I", color: "#e8590c", teachers: ["Dr. Priya Nair"],
      groups: [["Labs", 20], ["Homework", 20], ["Exams", 60]],
      topics: ["Newton's Laws", "Work & Energy", "Momentum", "Rotational Motion", "Projectile Motion"],
      graded: [["Lab 4: Friction", "Labs", 25, 22, 28], ["Mastering Ch. 6", "Homework", 30, 26, 21], ["Exam 2", "Exams", 100, 81, 14], ["Lab 5: Collisions", "Labs", 25, 21, 7], ["Mastering Ch. 8", "Homework", 30, 27, 3]] },
    { id: "4", code: "ENC 1102", name: "Composition II", color: "#ae3ec9", teachers: ["Prof. Marcus Hale"],
      groups: [["Essays", 60], ["Drafts", 25], ["Participation", 15]],
      topics: ["Argument & Claims", "Source Evaluation", "Annotated Bibliography", "Rhetorical Situations", "Rhetorical Analysis"],
      graded: [["Annotated Bibliography", "Essays", 100, 87, 24], ["Discussion 6", "Participation", 10, 10, 17], ["Proposal Draft", "Drafts", 50, 45, 11], ["Discussion 7", "Participation", 10, 9, 4]] },
    { id: "5", code: "EGN 1007", name: "Engineering Concepts", color: "#0c8599", teachers: ["Dr. Samuel Brooks"],
      groups: [["Journals", 20], ["Projects", 50], ["Participation", 30]],
      topics: ["Design Process", "Teamwork & Roles", "CAD Basics", "Prototyping", "Testing & Iteration"],
      graded: [["Design Journal Week 7", "Journals", 10, 10, 16], ["Bridge Prototype", "Projects", 100, 92, 13], ["Design Journal Week 8", "Journals", 10, 9, 9], ["Peer Eval 1", "Participation", 20, 19, 6]] },
  ];

  // [course, title, group, pts, due, submitted, missing]
  const UPCOMING = [
    ["4", "Discussion 8: Counterarguments", "Participation", 10, at(-1, 23, 59), false, true],
    ["3", "Lab 6: Projectile Motion", "Labs", 25, at(0), false, false],
    ["1", "WebAssign 8.3 — Series", "Homework", 20, at(1, 11, 59), false, false],
    ["2", "Project 3: Linked Lists", "Projects", 100, at(2), false, false],
    ["4", "Rhetorical Analysis Draft", "Drafts", 50, at(3, 17, 0), true, false],
    ["5", "Design Journal Week 9", "Journals", 10, at(4), false, false],
    ["1", "Quiz 7", "Quizzes", 10, at(5, 10, 0), false, false],
    ["3", "Mastering Physics Ch. 9", "Homework", 30, at(6), false, false],
    ["2", "Lab 8: Stacks", "Labs", 10, at(9), false, false],
    ["1", "Exam 3", "Exams", 100, at(12, 10, 0), false, false],
    ["4", "Rhetorical Analysis Final", "Essays", 100, at(13), false, false],
    ["5", "CAD Assembly Project", "Projects", 100, at(16), false, false],
  ];

  const ANNOUNCEMENTS = [
    ["2", "Project 3 office hours moved", "This week's office hours are Thursday 3–5pm in IST 1035 instead of Wednesday. Bring your test output.", -0.2],
    ["1", "Exam 2 grades posted", "Average was 78. Solutions are under Files › Exams. Regrade requests are open until Friday.", -1],
    ["4", "Peer review pairs", "Your peer review partner is listed in the Groups tab. Exchange drafts by Sunday night.", -2],
    ["3", "Lab 6 data sheets", "Use the updated data sheet posted in Module 5. The old one had the wrong launch angle table.", -3],
    ["5", "Bring laptops Wednesday", "We're starting CAD in class this week. Install Onshape beforehand and make a free education account.", -4],
    ["1", "Exam 3 review session", "Review session next Tuesday 6pm in IST 1007. Practice exam is posted under Files.", -5],
  ];

  function detail(c) {
    const graded = c.graded.map(([title, groupName, pts, score, daysAgo], i) => ({
      key: `d${c.id}-g${i}`, id: `${c.id}-g${i}`, title, groupName, pts, score, due: at(-daysAgo - 1),
      excused: false, omit: false, submitted: true, gradedAt: at(-daysAgo), missing: false, late: false, url: null, kind: kind(title),
    }));
    const open = UPCOMING.map((u, i) => [u, i]).filter(([u]) => u[0] === c.id).map(([[, title, groupName, pts, due, submitted, missing], i]) => ({
      key: `d${c.id}-u${i}`, id: `${c.id}-u${i}`, title, groupName, pts, score: null, due,
      excused: false, omit: false, submitted, gradedAt: null, missing, late: false, url: null, kind: kind(title),
    }));
    const items = [...graded, ...open];
    return {
      weighted: true,
      groups: c.groups.map(([name, weight], gi) => ({ id: `${c.id}-${gi}`, name, weight, rules: {}, items: items.filter(it => it.groupName === name) })),
      // Composition II doesn't use modules, to show how those courses look.
      modules: c.id === "4" ? [] : c.topics.map((topic, i) => {
        const week = i + 4, current = i === c.topics.length - 1;
        const work = current ? open.filter(it => it.due - now < 7 * DAY) : graded.filter((_, j) => j % c.topics.length === i);
        return {
          name: `Week ${week}: ${topic}`,
          items: [
            { type: "Page", title: `Week ${week} Overview`, url: null, done: true },
            { type: "File", title: `${topic} — Lecture Slides`, url: null, done: !current },
            { type: "Page", title: `Reading: ${topic}`, url: null, done: !current },
            ...work.map(it => ({ type: it.kind === "quiz" ? "Quiz" : "Assignment", title: it.title, url: null, assignmentId: it.id, done: it.submitted })),
          ],
        };
      }),
    };
  }

  // Weighted average over graded work, for the dashboard numbers.
  const score = c => {
    let e = 0, w = 0;
    for (const [g, weight] of c.groups) {
      const it = c.graded.filter(x => x[1] === g);
      if (!it.length) continue;
      e += it.reduce((s, x) => s + x[3], 0) / it.reduce((s, x) => s + x[2], 0) * weight; w += weight;
    }
    return w ? e / w * 100 : null;
  };

  // Things "turned in" during this visit, by assignment id.
  const turnedIn = {};
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const INSTRUCTIONS = {
    assignment: t => `<p>For <strong>${t}</strong>, work through the problems in the attached handout and show your reasoning for each one.</p>
      <h3>What to turn in</h3>
      <ul><li>A single PDF with your work, <em>or</em> a typed answer below</li><li>Label each problem clearly</li><li>Cite any sources you used</li></ul>
      <p>The rubric below shows how this will be graded. Questions? Post in the class Q&amp;A or come to office hours.</p>`,
    quiz: t => `<p><strong>${t}</strong> is timed (30 minutes) and covers everything since the last quiz. You get one attempt.</p>`,
    discussion: t => `<p>For <strong>${t}</strong>, pick one argument from this week's reading and write the strongest counterargument you can. Then reply to at least one classmate.</p>
      <blockquote>Aim for 150–250 words. Be specific and quote the text.</blockquote>`,
  };
  const RUBRIC = [
    { id: "r1", title: "Correctness", long: "Answers are right and complete.", pts: 50 },
    { id: "r2", title: "Reasoning", long: "Each step is explained, not just the final answer.", pts: 30 },
    { id: "r3", title: "Presentation", long: "Neat, labeled, easy to follow.", pts: 20 },
  ];

  function assignment(c, aid) {
    const it = detail(c).groups.flatMap(g => g.items).find(x => x.id === aid);
    if (!it) throw Object.assign(new Error("Not found"), { status: 404 });
    const k = it.kind, mine = turnedIn[aid];
    const scale = it.pts / 100;
    const submittedAt = mine?.at || (it.submitted ? at(-1, 20, 15) : null);
    return {
      id: aid,
      title: it.title,
      html: INSTRUCTIONS[k](it.title),
      due: it.due,
      lockAt: null,
      pts: it.pts,
      types: k === "quiz" ? ["online_quiz"] : k === "discussion" ? ["discussion_topic"] : ["online_upload", "online_text_entry", "online_url"],
      ext: [],
      attempts: -1,
      locked: false,
      lockText: "",
      url: null,
      stats: it.score != null ? { mean: Math.round(it.pts * 0.81), max: it.pts, min: Math.round(it.pts * 0.52) } : null,
      files: k === "assignment" ? [{ id: "f1", name: `${it.title} handout.pdf`, size: 482113, type: "application/pdf", url: null }] : [],
      rubric: k === "assignment" ? RUBRIC.map(r => ({
        ...r, pts: r.pts * scale,
        ratings: [["Full marks", 1], ["Mostly there", 0.7], ["Needs work", 0.4], ["Missing", 0]].map(([title, f], i) => ({ id: `${r.id}-${i}`, title, long: "", pts: Math.round(r.pts * f * scale * 10) / 10 })),
        got: it.score != null ? { pts: Math.round(r.pts * scale * (it.score / it.pts) * 10) / 10, rating: "", comment: r.id === "r2" ? "Show the substitution step next time." : "" } : null,
      })) : null,
      sub: {
        score: it.score, grade: null, graded: it.score != null,
        submittedAt, attempt: submittedAt ? (mine ? mine.attempt : 1) : 0,
        late: false, missing: it.missing && !mine, excused: false,
        body: mine?.html || "", url: mine?.url || null,
        files: (mine?.files || (it.submitted && k === "assignment" ? [{ name: "my-work.pdf", size: 913402 }] : [])).map(f => ({ ...f, url: null })),
        comments: it.score != null ? [{ author: c.teachers[0], text: "Nice work overall. See the rubric note about showing steps.", when: at(-1, 9, 30), files: [] }] : [],
      },
      discussion: k === "discussion" ? {
        id: "t1",
        entries: mine ? [
          { author: "Jordan Lee", html: "<p>I think the strongest counter is that the author assumes the data is representative, but the sample was all from one campus.</p>", when: at(-1, 14, 2), replies: [] },
          { author: "Aria Magby", html: mine.html, when: mine.at, replies: [] },
        ] : "locked",
      } : null,
    };
  }

  // Calendar events: [course or null, title, day offset, start hour, length in hours (0 = all day), location, description]
  const EVENTS = [
    ["1", "Exam 3 review session", 3, 18, 1.5, "IST 1007", "Bring questions. Practice exam is posted under Files."],
    ["2", "Office hours", 5, 15, 2, "IST 1035", "Moved from Wednesday this week."],
    ["3", "Lab section", 2, 9, 2, "BARC 1105", ""],
    ["3", "Lab section", 9, 9, 2, "BARC 1105", ""],
    ["4", "Peer review workshop", 6, 13, 1, "Library 210", "Bring two printed copies of your draft."],
    ["5", "Team check-in", 4, 16, 0.5, "Design Studio", ""],
    [null, "Fall break", 20, 0, 0, "", "No classes."],
    [null, "Fall break", 21, 0, 0, "", "No classes."],
    ["1", "Quiz 6 make-up window", -6, 10, 2, "Testing Center", ""],
  ];
  const plannerItems = () => UPCOMING.map(([courseId, title, , pts, due, submitted, missing], i) => ({ key: `demo-${i}`, courseId, assignmentId: `${courseId}-u${i}`, title, due, pts, submitted, missing, url: null, kind: kind(title) }));

  // Inbox: people per course, and conversations with their messages.
  const PEOPLE = {
    "1": [["t1", "Dr. Elena Ruiz"], ["s1", "Maya Chen"], ["s2", "Liam Ortiz"]],
    "2": [["t2", "Prof. Daniel Okafor"], ["s3", "Sam Patel"], ["s1", "Maya Chen"]],
    "3": [["t3", "Dr. Priya Nair"], ["s4", "Noah Kim"]],
    "4": [["t4", "Prof. Marcus Hale"], ["s5", "Jordan Lee"], ["s6", "Ava Brooks"]],
    "5": [["t5", "Dr. Samuel Brooks"], ["s3", "Sam Patel"], ["s7", "Ethan Wright"]],
  };
  let nextId = 100;
  const CONVOS = [
    { id: "c1", subject: "Exam 3 accommodations", courseName: "Calculus II", people: ["Dr. Elena Ruiz"], unread: true, msgs: [
      ["me", "Hi Dr. Ruiz, I'm approved for extended time through the accessibility office. Can I take Exam 3 at the testing center?", -1.2],
      ["Dr. Elena Ruiz", "Yes, that's fine. Book a slot for the same day and I'll send them the exam. Let me know once it's booked.", -0.3]] },
    { id: "c2", subject: "Peer review swap", courseName: "Composition II", people: ["Jordan Lee"], unread: true, msgs: [
      ["Jordan Lee", "Hey! We're peer review partners. Want to swap drafts Saturday night? I'll send mine as a Google Doc.", -0.5]] },
    { id: "c3", subject: "Project 3 question", courseName: "Programming II", people: ["Prof. Daniel Okafor"], unread: false, msgs: [
      ["me", "For Project 3, should removeAt() throw on an out-of-range index or return false?", -3],
      ["Prof. Daniel Okafor", "Throw std::out_of_range. It's in the updated spec under Files. Good question, I'll announce it.", -2.6]] },
    { id: "c4", subject: "Bridge team meeting", courseName: "Engineering Concepts", people: ["Sam Patel", "Ethan Wright"], unread: false, msgs: [
      ["Sam Patel", "Can everyone meet Thursday after class to finish the CAD assembly?", -4],
      ["me", "Works for me. I'll bring the measurements.", -3.8],
      ["Ethan Wright", "I'm in. Studio at 4?", -3.7]] },
  ];
  const convo = (cv, withMessages) => ({
    id: cv.id, subject: cv.subject, courseName: cv.courseName, people: cv.people, unread: cv.unread,
    when: at(cv.msgs.at(-1)[2], now.getHours(), now.getMinutes()), preview: cv.msgs.at(-1)[1],
    messages: withMessages ? cv.msgs.map(([who, body, d], i) => ({
      id: `${cv.id}-${i}`, author: who === "me" ? "Aria Magby" : who, mine: who === "me", body, files: [],
      when: d instanceof Date ? d : at(d, now.getHours(), now.getMinutes()),
    })) : undefined,
  });

  return {
    async loadAll() {
      return {
        user: { id: "me", name: "Aria Magby" },
        courses: COURSES.map(c => ({ id: c.id, code: c.code, name: c.name, color: c.color, score: score(c), letter: null, hidden: false, weighted: true, teachers: c.teachers, term: "Fall 2026", url: null })),
        planner: plannerItems(),
        announcements: ANNOUNCEMENTS.map(([courseId, title, body, d], i) => ({
          id: `an${i}`, courseId, title, body, html: `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
          author: COURSES.find(c => c.id === courseId).teachers[0], when: at(d, now.getHours(), now.getMinutes()),
          unread: i < 3, url: null,
          files: i === 1 ? [{ id: "an-f1", name: "Exam 2 solutions.txt", size: 812, type: "text/plain", url: null, courseId, demoText: "Exam 2 solutions (sample)\n\n1. Integral of x e^x dx = x e^x - e^x + C  (integration by parts, u = x)\n2. Integral of sin^2 x dx = x/2 - sin(2x)/4 + C\n3. The improper integral of 1/x^2 from 1 to infinity converges to 1." }] : [],
        })),
      };
    },
    async loadCourse(c) { return detail(COURSES.find(x => x.id === c.id)); },
    async loadAssignment(c, aid) { await wait(150); return assignment(COURSES.find(x => x.id === c.id), aid); },
    // Pretends to turn something in. Nothing leaves the browser.
    async submit(c, a, type, payload, onProgress) {
      const steps = type === "online_upload" ? 8 : 3;
      for (let i = 1; i <= steps; i++) { await wait(120); onProgress(i / steps, type === "online_upload" ? "Uploading…" : ""); }
      const prev = turnedIn[a.id];
      turnedIn[a.id] = { at: new Date(), attempt: (prev?.attempt || a.sub?.attempt || 0) + 1, html: payload.html, url: payload.url, files: payload.files?.map(f => ({ name: f.name, size: f.size })) };
      const u = UPCOMING[+a.id.split("-u")[1]];
      if (u) { u[5] = true; u[6] = false; }
    },

    async loadRange(start, end) {
      await wait(150);
      const inRange = d => d >= start && d < end;
      return {
        planner: plannerItems().filter(p => inRange(p.due)),
        events: EVENTS.map(([courseId, title, day, hour, hours, location, desc], i) => {
          const s = at(day, hour, (hour % 1) * 60);
          return { id: `e${i}`, courseId, title, start: hours ? s : at(day, 0, 0), end: hours ? new Date(s.getTime() + hours * 36e5) : null, allDay: !hours, location, desc, url: null };
        }).filter(e => inRange(e.start)),
      };
    },
    async unreadCount() { return CONVOS.filter(c => c.unread).length; },
    async loadInbox(scope, courseId) {
      await wait(120);
      const course = COURSES.find(c => c.id === courseId);
      return CONVOS
        .filter(c => scope !== "unread" || c.unread)
        .filter(c => scope !== "sent" || c.msgs.some(m => m[0] === "me"))
        .filter(c => !course || c.courseName === course.name)
        .map(c => convo(c, false)).sort((a, b) => b.when - a.when);
    },
    async loadConversation(id) {
      await wait(120);
      const cv = CONVOS.find(c => c.id === id);
      if (!cv) throw Object.assign(new Error("Not found"), { status: 404 });
      cv.unread = false;
      return convo(cv, true);
    },
    async reply(id, body) {
      await wait(400);
      const cv = CONVOS.find(c => c.id === id);
      cv.msgs.push(["me", body, new Date()]);
      return convo(cv, true);
    },
    async send({ courseId, to, subject, body }) {
      await wait(400);
      const id = `c${nextId++}`;
      CONVOS.push({ id, subject: subject || "(No subject)", courseName: COURSES.find(c => c.id === courseId).name, people: to.map(r => r.name), unread: false, msgs: [["me", body, new Date()]] });
      return id;
    },
    async loadCourseFiles(c) {
      await wait(150);
      const course = COURSES.find(x => x.id === c.id);
      const id = n => `${c.id}-${n}`;
      const folders = [
        { id: id("root"), name: "course files", parentId: null, path: "" },
        { id: id("slides"), name: "Lecture Slides", parentId: id("root"), path: "Lecture Slides" },
        { id: id("handouts"), name: "Handouts", parentId: id("root"), path: "Handouts" },
        { id: id("readings"), name: "Readings", parentId: id("handouts"), path: "Handouts/Readings" },
      ];
      const file = (n, name, folder, days, size, type, demoText) => ({ id: id(`f${n}`), name, folderId: id(folder), courseId: c.id, updated: at(-days, 9, 0), size, type, url: null, locked: false, demoText });
      const files = [
        file(1, "Syllabus.txt", "root", 60, 4210, "text/plain", `${course.name} (${course.code}) Syllabus\n\nInstructor: ${course.teachers[0]}\n\nGrading:\n${course.groups.map(([g, w]) => `  ${g}: ${w}%`).join("\n")}\n\nLate work: 10% off per day, up to 3 days.\nOffice hours are posted on the course home page.`),
        ...course.topics.map((t, i) => file(10 + i, `Week ${i + 4} - ${t}.pptx`, "slides", 30 - i * 6, 2_400_000 + i * 310_000, "application/vnd.openxmlformats-officedocument.presentationml.presentation")),
        file(20, `${course.topics.at(-1)} worksheet.pdf`, "handouts", 3, 482_113, "application/pdf"),
        file(21, "Study guide.md", "handouts", 2, 1890, "text/markdown", `# ${course.name} study guide\n\n## Topics\n${course.topics.map(t => `- ${t}`).join("\n")}\n\n## Tips\n- Do the practice problems before the review session.\n- Bring questions to office hours.`),
        file(22, "Chapter reading.pdf", "readings", 20, 3_120_000, "application/pdf"),
        file(23, "Diagram.png", "handouts", 12, 210_442, "image/png"),
      ];
      return { rootId: id("root"), folders, files };
    },
    async searchRecipients(courseId, q) {
      await wait(80);
      return (PEOPLE[courseId] || []).filter(([, name]) => name.toLowerCase().includes(q.toLowerCase())).map(([id, name]) => ({ id, name }));
    },
  };
})();
