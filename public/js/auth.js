import { backend, CONFIG_READY } from "./data.js";

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("authError");
const loginBtn = document.getElementById("loginBtn");
const configWarning = document.getElementById("configWarning");

if (!CONFIG_READY) configWarning.style.display = "block";

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
}

async function doLogin(email, password) {
  errorBox.classList.remove("show");
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";
  try {
    await backend.login(email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    showError(err.message || "Could not sign in. Check your email/password.");
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign in";
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  doLogin(email, password);
});

// Already logged in? Skip straight to dashboard.
const existing = backend.currentUser();
if (existing) window.location.href = "dashboard.html";
