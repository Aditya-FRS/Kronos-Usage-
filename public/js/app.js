import { backend, CONFIG_READY, WEEKDAYS, WEEKDAY_LABELS, todayStr, weekdayKey, isAdmin } from "./data.js";

const DISPLAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// ------------------------------- auth guard --------------------------------
const me = backend.currentUser();
if (!me) window.location.href = "index.html";

let myProfile = null;
let mySchedule = null;
let myStatuses = {};
let allUsers = [];
let selectedDay = DISPLAY_ORDER[(new Date().getDay() + 6) % 7]; // today, mon-based
let attDate = todayStr();
let rosterSearchTerm = "";
let scheduleSearchTerm = "";
let scheduleMyOnly = false;
let currentAttendanceRows = [];

// notifications
let notifications = [];
let notifStatusInitialized = false;
const remindedSlotKeys = new Set();

function initials(name) {
  return (name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function minutesBetween(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
function fmtDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function fmtMinutes(min) {
  if (min == null) return "0m";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (ts.toMillis) return ts.toMillis();
  return null;
}
function nowInSlot(start, end) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return cur >= sh * 60 + sm && cur < eh * 60 + em;
}

// ------------------------------- boot ---------------------------------
async function boot() {
  myProfile = await backend.ensureUserProfile(me.email, me.displayName || me.email);
  document.getElementById("meAvatar").textContent = initials(myProfile.name);
  document.getElementById("meName").textContent = myProfile.name;
  document.getElementById("meEmail").textContent = myProfile.email;
  document.getElementById("welcomeName").textContent = `, ${myProfile.name.split(" ")[0]}`;
  if (isAdmin(myProfile.email)) {
    document.querySelector("#meName").insertAdjacentHTML("beforeend", ' <span class="badge badge-admin">Admin</span>');
  }
  if (!CONFIG_READY) document.getElementById("configWarningBanner").style.display = "block";

  allUsers = await backend.listUsers();
  mySchedule = await backend.getSchedule();

  renderDayTabs();
  renderScheduleView();
  renderAttendance();
  renderStatCards();

  backend.subscribeStatuses((statuses) => {
    diffStatusesForNotifications(myStatuses, statuses);
    myStatuses = statuses;
    renderRoster();
    renderMyStatusHero();
  });

  setInterval(() => {
    renderClock();
    renderMyStatusHero();
    renderRoster();
  }, 1000);
  setInterval(renderStatCards, 20000);
  setInterval(checkUpcomingSlotReminders, 30000);
  renderClock();
  checkUpcomingSlotReminders();
}

// ------------------------------- clock ---------------------------------
function renderClock() {
  const now = new Date();
  document.getElementById("clockTime").textContent = now.toLocaleTimeString();
  document.getElementById("clockDate").textContent = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

// --------------------------- nav / view switching ---------------------------
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
  });
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await backend.logout();
  window.location.href = "index.html";
});

// --------------------------------- status ---------------------------------
const toggleBtn = document.getElementById("toggleBtn");
toggleBtn.addEventListener("click", async () => {
  toggleBtn.disabled = true;
  const active = !!(myStatuses[myProfile.email] && myStatuses[myProfile.email].active);
  try {
    if (active) await backend.setInactive(myProfile.email);
    else await backend.setActive(myProfile.email, myProfile.name);
    renderStatCards();
  } finally {
    toggleBtn.disabled = false;
  }
});

function renderMyStatusHero() {
  const s = myStatuses[myProfile.email];
  const dot = document.getElementById("myDot");
  const title = document.getElementById("myStatusTitle");
  const sub = document.getElementById("myStatusSub");
  const timer = document.getElementById("myTimer");
  const active = !!(s && s.active);
  dot.classList.toggle("on", active);
  toggleBtn.textContent = active ? "Stop Using Instance" : "Start Using Instance";
  toggleBtn.className = active ? "btn btn-danger" : "btn";
  if (active) {
    title.textContent = "You're currently using the instance";
    const since = toMillis(s.since) || Date.now();
    sub.textContent = `Started at ${new Date(since).toLocaleTimeString()}`;
    timer.style.display = "block";
    timer.textContent = fmtDuration(Date.now() - since);
  } else {
    title.textContent = "You're not using the instance";
    sub.textContent = "Toggle on when you start your session.";
    timer.style.display = "none";
  }
  renderMySlotsToday();
}

function renderRoster() {
  const list = document.getElementById("rosterList");
  const term = rosterSearchTerm.trim().toLowerCase();
  const allKnown = allUsers.length ? allUsers : [myProfile];
  const users = allKnown.filter((u) => !term || u.name.toLowerCase().includes(term));
  const activeCount = allKnown.filter((u) => myStatuses[u.email] && myStatuses[u.email].active).length;
  list.innerHTML = "";
  if (!users.length) list.innerHTML = `<div class="empty-hint">No one matches "${rosterSearchTerm}".</div>`;
  users.forEach((u) => {
    const s = myStatuses[u.email];
    const active = !!(s && s.active);
    const row = document.createElement("div");
    row.className = "roster-row";
    const since = active ? toMillis(s.since) : null;
    row.innerHTML = `
      <div class="roster-left">
        <div class="pulse-dot ${active ? "on" : ""}"></div>
        <div>
          <div class="roster-name">${u.name}${u.email === myProfile.email ? " (you)" : ""}</div>
          <div class="roster-meta">${active ? "Using now" : "Idle"}</div>
        </div>
      </div>
      <div class="roster-time">${active && since ? fmtDuration(Date.now() - since) : "—"}</div>
    `;
    list.appendChild(row);
  });
  document.getElementById("liveCount").textContent = `${activeCount} active`;
}

function renderMySlotsToday() {
  const container = document.getElementById("mySlotsToday");
  const wd = weekdayKey();
  document.getElementById("todayLabel").textContent = WEEKDAY_LABELS[wd];
  const slots = (mySchedule[wd] || []).filter((s) => s.email === myProfile.email);
  if (!slots.length) {
    container.innerHTML = `<div class="empty-hint">No slot assigned to you today.</div>`;
    return;
  }
  container.innerHTML = slots.map((s) => `
    <div class="slot-row ${nowInSlot(s.start, s.end) ? "current" : ""}">
      <div class="slot-time">${s.start}–${s.end}</div>
      <div class="slot-name">${s.name}</div>
      <div class="roster-meta">${nowInSlot(s.start, s.end) ? "🟢 now" : ""}</div>
    </div>
  `).join("");
}

// -------------------------------- schedule ---------------------------------
function renderDayTabs() {
  const tabs = document.getElementById("dayTabs");
  const today = WEEKDAYS[new Date().getDay()];
  tabs.innerHTML = DISPLAY_ORDER.map((d) => `
    <button class="day-tab ${d === selectedDay ? "active" : ""} ${d === today ? "today" : ""}" data-day="${d}">
      ${WEEKDAY_LABELS[d].slice(0, 3)}
    </button>
  `).join("");
  tabs.querySelectorAll(".day-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDay = btn.dataset.day;
      renderDayTabs();
      renderScheduleView();
    });
  });
}

function renderScheduleView() {
  const admin = isAdmin(myProfile.email);
  document.getElementById("scheduleAdminHint").textContent = admin ? "You can edit this schedule" : "Only admins can edit";
  document.getElementById("scheduleAdminControls").classList.toggle("show", admin);

  const container = document.getElementById("scheduleSlots");
  const slots = mySchedule[selectedDay] || [];
  if (!slots.length) {
    container.innerHTML = `<div class="empty-hint">No slots for ${WEEKDAY_LABELS[selectedDay]}.</div>`;
    return;
  }
  const term = scheduleSearchTerm.trim().toLowerCase();
  const matchesFilter = (s) =>
    (!term || s.name.toLowerCase().includes(term)) &&
    (!scheduleMyOnly || s.email === myProfile.email);

  if (!admin) {
    const visible = slots.filter(matchesFilter);
    container.innerHTML = visible.length ? visible.map((s) => `
        <div class="slot-row ${nowInSlot(s.start, s.end) && selectedDay === weekdayKey() ? "current" : ""}">
          <div class="slot-time">${s.start}–${s.end}</div>
          <div class="slot-name">${s.name}</div>
          <div class="roster-meta">${s.email === myProfile.email ? "You" : ""}</div>
        </div>`).join("") : `<div class="empty-hint">No matching slots.</div>`;
    return;
  }

  // Admin mode: always render every row (so Save doesn't drop hidden ones),
  // just visually hide rows that don't match the current search/filter.
  container.innerHTML = slots.map((s, i) => {
    const options = (allUsers.length ? allUsers : [myProfile]).map((u) =>
      `<option value="${u.email}" ${u.email === s.email ? "selected" : ""}>${u.name}</option>`
    ).join("");
    return `
      <div class="slot-row editable ${matchesFilter(s) ? "" : "hidden-row"}" data-idx="${i}">
        <div class="time-pair">
          <input type="time" class="slot-start" value="${s.start}" />
          <input type="time" class="slot-end" value="${s.end}" />
        </div>
        <select class="slot-user">${options}</select>
        <button class="btn btn-ghost btn-sm remove-slot">Remove</button>
      </div>`;
  }).join("");

  if (admin) {
    container.querySelectorAll(".remove-slot").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.target.closest(".slot-row").dataset.idx);
        mySchedule[selectedDay].splice(idx, 1);
        renderScheduleView();
      });
    });
  }
}

document.getElementById("addSlotBtn").addEventListener("click", () => {
  const u = allUsers[0] || myProfile;
  mySchedule[selectedDay] = mySchedule[selectedDay] || [];
  mySchedule[selectedDay].push({ start: "09:00", end: "11:00", email: u.email, name: u.name });
  renderScheduleView();
});

document.getElementById("saveScheduleBtn").addEventListener("click", async () => {
  const rows = document.querySelectorAll("#scheduleSlots .slot-row[data-idx]");
  const byEmail = Object.fromEntries((allUsers.length ? allUsers : [myProfile]).map((u) => [u.email, u.name]));
  const updated = [];
  rows.forEach((row) => {
    const start = row.querySelector(".slot-start").value;
    const end = row.querySelector(".slot-end").value;
    const email = row.querySelector(".slot-user").value;
    updated.push({ start, end, email, name: byEmail[email] || email });
  });
  updated.sort((a, b) => a.start.localeCompare(b.start));
  mySchedule[selectedDay] = updated;
  const btn = document.getElementById("saveScheduleBtn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    await backend.saveSchedule(mySchedule);
    btn.textContent = "Saved ✓";
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = "Save schedule"; }, 1200);
    renderScheduleView();
    renderAttendance();
  }
});

// ------------------------------- attendance ---------------------------------
const attDateInput = document.getElementById("attDate");
attDateInput.value = attDate;
attDateInput.addEventListener("change", () => {
  attDate = attDateInput.value || todayStr();
  renderAttendance();
});

async function renderAttendance() {
  const date = attDate;
  const d = new Date(`${date}T00:00:00`);
  const wd = WEEKDAYS[d.getDay()];
  const slots = mySchedule[wd] || [];
  const tbody = document.getElementById("attTableBody");
  const emptyHint = document.getElementById("attEmptyHint");

  if (!slots.length) {
    tbody.innerHTML = "";
    emptyHint.style.display = "block";
    currentAttendanceRows = [];
    return;
  }
  emptyHint.style.display = "none";

  const assignedByUser = {};
  slots.forEach((s) => {
    assignedByUser[s.email] = assignedByUser[s.email] || { name: s.name, minutes: 0 };
    assignedByUser[s.email].minutes += minutesBetween(s.start, s.end);
  });

  const logs = await backend.getUsageLogsForDate(date);
  const usedByUser = {};
  logs.forEach((l) => {
    const endMs = l.end ? toMillis(l.end) : Date.now();
    const startMs = toMillis(l.start) || endMs;
    const dur = l.durationMin != null ? l.durationMin : Math.round((endMs - startMs) / 60000);
    usedByUser[l.email] = (usedByUser[l.email] || 0) + dur;
  });

  currentAttendanceRows = Object.entries(assignedByUser).map(([email, info]) => {
    const used = usedByUser[email] || 0;
    const pct = info.minutes > 0 ? Math.round((used / info.minutes) * 100) : 0;
    return { email, name: info.name, assignedMin: info.minutes, usedMin: used, pct };
  });

  tbody.innerHTML = currentAttendanceRows.map((row) => {
    const over = row.pct > 100;
    return `
      <tr>
        <td>${row.name}${row.email === myProfile.email ? " (you)" : ""}</td>
        <td>${fmtMinutes(row.assignedMin)}</td>
        <td>${fmtMinutes(row.usedMin)}</td>
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="bar-track" style="flex:1;"><div class="bar-fill ${over ? "over" : ""}" style="width:${Math.min(100, row.pct)}%"></div></div>
            <span class="pct">${row.pct}%</span>
          </div>
        </td>
      </tr>`;
  }).join("");
}

document.getElementById("exportCsvBtn").addEventListener("click", () => {
  if (!currentAttendanceRows.length) return;
  const header = "Name,Email,Assigned (min),Used (min),Utilization %";
  const lines = currentAttendanceRows.map((r) =>
    [r.name, r.email, r.assignedMin, r.usedMin, r.pct].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${attDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ------------------------------- search & filters ---------------------------------
document.getElementById("rosterSearch").addEventListener("input", (e) => {
  rosterSearchTerm = e.target.value;
  renderRoster();
});
document.getElementById("scheduleSearch").addEventListener("input", (e) => {
  scheduleSearchTerm = e.target.value;
  renderScheduleView();
});
document.getElementById("myScheduleOnly").addEventListener("click", (e) => {
  scheduleMyOnly = !scheduleMyOnly;
  e.currentTarget.classList.toggle("active", scheduleMyOnly);
  renderScheduleView();
});

// ------------------------------- stat cards ---------------------------------
async function renderStatCards() {
  const allKnown = allUsers.length ? allUsers : [myProfile];
  const activeCount = allKnown.filter((u) => myStatuses[u.email] && myStatuses[u.email].active).length;
  document.getElementById("statActiveNow").textContent = String(activeCount);

  const logs = await backend.getUsageLogsForDate(todayStr());
  const usedByUser = {};
  logs.forEach((l) => {
    const endMs = l.end ? toMillis(l.end) : Date.now();
    const startMs = toMillis(l.start) || endMs;
    const dur = l.durationMin != null ? l.durationMin : Math.round((endMs - startMs) / 60000);
    usedByUser[l.email] = { name: l.name, minutes: (usedByUser[l.email]?.minutes || 0) + dur };
  });
  const totalMin = Object.values(usedByUser).reduce((sum, u) => sum + u.minutes, 0);
  document.getElementById("statHoursToday").textContent = fmtMinutes(totalMin);

  const top = Object.values(usedByUser).sort((a, b) => b.minutes - a.minutes)[0];
  document.getElementById("statTopUser").textContent = top && top.minutes > 0 ? `${top.name} (${fmtMinutes(top.minutes)})` : "—";
}

// ------------------------------- notifications ---------------------------------
function pushNotification(text) {
  notifications.unshift({ text, ts: Date.now() });
  notifications = notifications.slice(0, 30);
  document.getElementById("notifDot").classList.add("show");
  renderNotifList();
}

function renderNotifList() {
  const list = document.getElementById("notifList");
  if (!notifications.length) {
    list.innerHTML = `<div class="empty-hint" style="padding:10px;">No notifications yet.</div>`;
    return;
  }
  list.innerHTML = notifications.map((n) => `
    <div class="notif-item">
      <div>${n.text}</div>
      <div class="t">${new Date(n.ts).toLocaleTimeString()}</div>
    </div>`).join("");
}

function diffStatusesForNotifications(prev, next) {
  if (!notifStatusInitialized) { notifStatusInitialized = true; return; } // skip noise on first load
  Object.keys(next).forEach((email) => {
    if (email === myProfile.email) return; // don't notify about your own actions
    const wasActive = !!(prev[email] && prev[email].active);
    const isActive = !!(next[email] && next[email].active);
    if (!wasActive && isActive) pushNotification(`🟢 ${next[email].name} started using the instance`);
    if (wasActive && !isActive) pushNotification(`⚪ ${prev[email].name} stopped using the instance`);
  });
}

function checkUpcomingSlotReminders() {
  const wd = weekdayKey();
  const mySlots = (mySchedule[wd] || []).filter((s) => s.email === myProfile.email);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  mySlots.forEach((s) => {
    const [sh, sm] = s.start.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const untilStart = startMin - nowMin;
    const key = `${todayStr()}_${s.start}`;
    if (untilStart >= 0 && untilStart <= 10 && !remindedSlotKeys.has(key)) {
      remindedSlotKeys.add(key);
      pushNotification(`⏰ Your slot starts at ${s.start} — in ${untilStart} minute${untilStart === 1 ? "" : "s"}`);
    }
  });
}

const notifBell = document.getElementById("notifBell");
const notifPanel = document.getElementById("notifPanel");
notifBell.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = !notifPanel.classList.contains("open");
  notifPanel.classList.toggle("open", opening);
  if (opening) {
    document.getElementById("notifDot").classList.remove("show");
    renderNotifList();
  }
});
document.addEventListener("click", (e) => {
  if (!notifPanel.contains(e.target) && e.target !== notifBell) notifPanel.classList.remove("open");
});

boot();
