import { backend } from "./data.js";

const me = backend.currentUser();
if (!me) window.location.href = "index.html";

const messagesEl = document.getElementById("chatMessages");
const form = document.getElementById("chatForm");
const input = document.getElementById("chatInput");

const seenIds = new Set();
let firstSnapshot = true;

function toMillis(ts) {
  if (!ts) return Date.now();
  if (typeof ts === "number") return ts;
  if (ts.toMillis) return ts.toMillis();
  return Date.now();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------- notification sound ----------------------------
function playPing() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    o.onended = () => ctx.close();
  } catch (err) { /* autoplay may be blocked until the user interacts with the page once */ }
}

// ----------------------------- in-page toast popup ---------------------------
function showToast(name, text) {
  const container = document.getElementById("toastContainer") || document.body;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `💬 <div><b>${escapeHtml(name)}</b><br>${escapeHtml(text)}</div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// --------------------------- native OS notification --------------------------
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission().catch(() => {});
}
function showBrowserNotification(name, text) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return; // avoid double-alerting when tab is focused (toast already shown)
  try { new Notification(`New message from ${name}`, { body: text, icon: undefined }); } catch (err) {}
}

function render(messages) {
  const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;

  const incoming = messages.filter((m) => m.id && !seenIds.has(m.id));
  incoming.forEach((m) => seenIds.add(m.id));
  if (!firstSnapshot) {
    incoming.filter((m) => m.email !== me.email).forEach((m) => {
      playPing();
      showToast(m.name, m.text);
      showBrowserNotification(m.name, m.text);
    });
  }
  firstSnapshot = false;

  if (!messages.length) {
    messagesEl.innerHTML = `<div class="empty-hint">No messages yet — say hi 👋</div>`;
    return;
  }
  messagesEl.innerHTML = messages.map((m) => {
    const mine = m.email === me.email;
    const time = new Date(toMillis(m.ts)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="chat-msg ${mine ? "me" : ""}">
        <div class="who">${mine ? "You" : m.name}<span>${time}</span></div>
        <div class="chat-bubble">${escapeHtml(m.text)}</div>
      </div>`;
  }).join("");
  if (wasAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

backend.subscribeChat(render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const profile = await backend.ensureUserProfile(me.email, me.displayName || me.email);
  await backend.sendChatMessage(profile.email, profile.name, text);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});
