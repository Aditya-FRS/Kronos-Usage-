// ---------------------------------------------------------------------------
// Fill these in with your own Firebase project's web config (see README.md ->
// "Firebase setup"). This app requires a real Firebase project to function —
// it stores every user, status change, usage session, schedule edit, and
// chat message in Firestore so all 6 people see the same live data.
// ---------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: "AIzaSyAupC_gE4o7PMLXgaGpMNLBSIld8w6I-0k",
  authDomain: "kronos-5aff6.firebaseapp.com",
  projectId: "kronos-5aff6",
  storageBucket: "kronos-5aff6.firebasestorage.app",
  messagingSenderId: "1057500959007",
  appId: "1:1057500959007:web:a9bf45b39085903f9c602a",
};

// True once you've replaced the placeholder apiKey above with a real one.
export const CONFIG_READY = firebaseConfig.apiKey !== "AIzaSyAupC_gE4o7PMLXgaGpMNLBSIld8w6I-0k";

// Emails treated as admins (can edit the weekly schedule).
export const ADMIN_EMAILS = ["doraemon@kronos.com"];
