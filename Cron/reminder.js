// ---------------------------------------------------------------------------
// Runs on a schedule (GitHub Actions, every 5 minutes — see
// .github/workflows/reminder.yml) — completely independent of whether
// anyone has the InstanceTrack dashboard open.
//
// Each run:
//   1. Reads the weekly schedule from Firestore (config/schedule).
//   2. Finds slot(s) whose start time is between 0 and REMINDER_MINUTES_BEFORE
//      minutes from now (in APP_TIMEZONE) — a window, not an exact-minute
//      match, so this tolerates the scheduler firing a bit early/late/less
//      often than once a minute (GitHub Actions schedules aren't
//      minute-precise).
//   3. For each match not already reminded (deduped via the `reminders`
//      collection, so re-checking the same slot across runs is safe),
//      emails the assigned user via Resend.
// ---------------------------------------------------------------------------
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const REQUIRED_ENV = ["FIREBASE_SERVICE_ACCOUNT_JSON", "RESEND_API_KEY", "RESEND_FROM"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}. See cron/.env.example.`);
    process.exit(1);
  }
}

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const REMINDER_MINUTES_BEFORE = Number(process.env.REMINDER_MINUTES_BEFORE || 5);

const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, "base64").toString("utf8")
);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function partsInTimeZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday.toLowerCase().slice(0, 3), // "mon", "tue", ...
  };
}

async function sendReminderEmail(toEmail, name, slot) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [toEmail],
      subject: `⏰ Your instance slot starts in ${REMINDER_MINUTES_BEFORE} minutes`,
      html: `
        <div style="font-family:sans-serif;font-size:15px;color:#222;">
          <p>Hi ${name},</p>
          <p>This is a reminder that your assigned time on the shared instance starts at
             <b>${slot.start}</b> and runs until <b>${slot.end}</b> today.</p>
          <p>Please make sure any current session is wrapped up so you can start on time.</p>
          <p style="color:#888;font-size:12px;">Sent automatically by InstanceTrack.</p>
        </div>`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

async function run() {
  const now = new Date();
  const { date, time, weekday } = partsInTimeZone(now, APP_TIMEZONE);
  const [nowH, nowM] = time.split(":").map(Number);
  const nowMinutes = nowH * 60 + nowM;

  console.log(`[reminder] checking slots for ${weekday} (${date}), now ${time}`);

  const scheduleSnap = await db.collection("config").doc("schedule").get();
  if (!scheduleSnap.exists) {
    console.log("[reminder] no schedule configured yet, skipping.");
    return;
  }
  const schedule = scheduleSnap.data();
  const todaySlots = schedule[weekday] || [];
  const matches = todaySlots.filter((s) => {
    const [sh, sm] = s.start.split(":").map(Number);
    const minutesUntilStart = (sh * 60 + sm) - nowMinutes;
    return minutesUntilStart >= 0 && minutesUntilStart <= REMINDER_MINUTES_BEFORE;
  });

  if (!matches.length) {
    console.log("[reminder] no slots starting in the reminder window.");
    return;
  }

  for (const slot of matches) {
    const reminderId = `${date}_${slot.start}_${slot.email}`.replace(/[^a-zA-Z0-9_@.:-]/g, "_");
    const reminderRef = db.collection("reminders").doc(reminderId);

    const sent = await db.runTransaction(async (tx) => {
      const doc = await tx.get(reminderRef);
      if (doc.exists) return false;
      tx.set(reminderRef, { sent: true, sentAt: FieldValue.serverTimestamp(), email: slot.email, slot });
      return true;
    });

    if (!sent) {
      console.log(`[reminder] already sent for ${slot.email} @ ${slot.start} on ${date}, skipping.`);
      continue;
    }

    try {
      await sendReminderEmail(slot.email, slot.name || slot.email, slot);
      console.log(`[reminder] sent to ${slot.email} for slot ${slot.start}-${slot.end}`);
    } catch (err) {
      console.error(`[reminder] FAILED to email ${slot.email}:`, err.message);
      // Roll back the dedup flag so the next run retries.
      await reminderRef.delete().catch(() => {});
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error("[reminder] fatal error:", err); process.exit(1); });
