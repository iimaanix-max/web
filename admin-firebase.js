import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, reload, setPersistence, browserLocalPersistence, sendEmailVerification } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getDatabase, onValue, ref, set, remove, update } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-storage.js";
import { firebaseConfig, firebaseAdminEmail, firebaseAppCheckSiteKey } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
if (firebaseAppCheckSiteKey) {
  const { initializeAppCheck, ReCaptchaV3Provider } = await import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app-check.js");
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(firebaseAppCheckSiteKey), isTokenAutoRefreshEnabled: true });
}
const auth = getAuth(app);
try {
  await setPersistence(auth, browserLocalPersistence);
} catch (e) {
  console.warn("Auth persistence notice:", e);
}
const db = getDatabase(app);
const storage = getStorage(app);
const gate = document.getElementById("auth-gate");
const appPanel = document.getElementById("admin-app");
const message = document.getElementById("auth-message");
const banner = document.getElementById("admin-status-banner");
const loginForm = document.getElementById("admin-login-form");
let stopInbox = null;
let stopBlockedIps = null;
const IP_ADMIN_ENDPOINT = "https://asia-southeast1-imaanix.cloudfunctions.net/manageContactIp";
async function manageIp(action, ip) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to manage blocked IPs.");
  const response = await fetch(IP_ADMIN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + await user.getIdToken() }, body: JSON.stringify({ action, ip }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Could not update IP block.");
}
function renderBlockedIps(snapshot) {
  const host = document.getElementById("blocked-ips-list"); if (!host) return;
  host.replaceChildren();
  const rows = snapshot.exists() ? Object.entries(snapshot.val()).map(([key, value]) => ({ key, ...(value || {}) })) : [];
  if (!rows.length) { host.textContent = "No IP addresses are blocked."; return; }
  for (const row of rows) {
    const line = document.createElement("div"); line.className = "item";
    const info = document.createElement("div"); info.className = "item-info";
    const ip = document.createElement("b"); ip.textContent = row.ip || "Unknown IP";
    const detail = document.createElement("small"); detail.textContent = (row.reason === "admin" ? "Blocked by admin" : "Temporary rate-limit block") + " · " + (row.blockedUntil ? new Date(row.blockedUntil).toLocaleString() : "No expiry");
    info.append(ip, detail);
    const button = document.createElement("button"); button.className = "btn secondary small"; button.type = "button"; button.textContent = "Unblock";
    button.onclick = async () => { try { await manageIp("unblock", row.ip); } catch (error) { alert(error.message); } };
    line.append(info, button); host.append(line);
  }
}
const ipBlockForm = document.getElementById("ip-block-form");
ipBlockForm?.addEventListener("submit", async event => {
  event.preventDefault(); const ip = document.getElementById("ip-block-address").value.trim(); const status = document.getElementById("ip-block-status");
  try { await manageIp("block", ip); status.textContent = "IP blocked."; ipBlockForm.reset(); } catch (error) { status.textContent = error.message; }
});


function say(text) { if (message) message.textContent = text; }
function setBanner(text, connected = false) {
  const label = document.createElement("b");
  label.textContent = "Firebase admin:";
  banner.replaceChildren(label, document.createTextNode(" " + text));
  banner.classList.toggle("connected", connected);
}
function setPublishStatus(state, text) {
  const status = document.getElementById("publish-status");
  if (!status) return;
  status.dataset.state = state;
  status.textContent = text;
  status.hidden = false;
}
function showVerificationEmailAction(user) {
  const status = document.getElementById("publish-status");
  if (!status) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn secondary small";
  button.textContent = "Send verification email";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      await sendEmailVerification(user);
      setPublishStatus("success", "Verification email sent to " + user.email + ". Open that email and click its verification link, then return here and publish again.");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Send verification email";
      setPublishStatus("error", "Could not send the verification email: " + friendly(error));
      document.getElementById("publish-status")?.append(" ", button);
    }
  });
  status.append(" ", button);
}
function withTimeout(promise, label, ms = 30000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timed out after 30 seconds. Check the connection and try publishing again.")), ms); })]).finally(() => clearTimeout(timer));
}
function friendly(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-email")) return "Email ya password galat hai.";
  if (code.includes("unauthorized-domain")) return "Allow iimaanix-max.github.io in Firebase Authentication → Settings → Authorized domains, then try again.";
  if (code.includes("operation-not-allowed")) return "Enable Email/Password sign-in in Firebase Authentication → Sign-in method.";
  if (code.includes("too-many-requests")) return "Firebase temporarily paused sign-in attempts. Wait a little and try again.";
  if (code.includes("network-request-failed")) return "Network error. Check your connection and try again.";
  if (code.includes("permission-denied")) return "Firebase denied access. Deploy the supplied RTDB and Storage rules for this admin account.";
  return error?.message || "Firebase request failed.";
}
const loginLimitKey = "imaanix-admin-login-limit-v1";
const loginWindowMs = 15 * 60 * 1000;
const loginMaxAttempts = 5;
function getLoginAttempts() {
  try {
    const data = JSON.parse(localStorage.getItem(loginLimitKey) || "null");
    const now = Date.now();
    return Array.isArray(data) ? data.filter(time => Number.isFinite(time) && now - time < loginWindowMs) : [];
  } catch { return []; }
}
function saveLoginAttempt() {
  const attempts = [...getLoginAttempts(), Date.now()];
  try { localStorage.setItem(loginLimitKey, JSON.stringify(attempts)); } catch {}
  return attempts;
}
function clearLoginAttempts() {
  try { localStorage.removeItem(loginLimitKey); } catch {}
}

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
let inactivityTimer = null;
function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (!auth.currentUser) return;
  inactivityTimer = setTimeout(async () => {
    try {
      await signOut(auth);
      say("Session expired due to 30 minutes of inactivity. Please sign in again.");
      setBanner("Session expired (inactivity).");
    } catch (e) {}
  }, INACTIVITY_TIMEOUT_MS);
}
['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, resetInactivityTimer, { passive: true });
});

function showInbox(items) {
  const host = document.getElementById("inquiries-list");
  const count = document.getElementById("inquiries-count");
  if (!host) return;
  if (count) count.textContent = items.length + " message" + (items.length === 1 ? "" : "s");
  if (!items.length) { host.innerHTML = '<div class="empty">No inquiries yet. New website messages will appear here.</div>'; return; }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const emailAddress = value => /^[^\s@?&]+@[^\s@?&]+\.[^\s@?&]+$/.test(String(value || ""));
  host.innerHTML = items.map(item => {
    const safeEmail = String(item.email || "").trim();
    const emailMarkup = emailAddress(safeEmail)
      ? '<a href="mailto:' + encodeURIComponent(safeEmail) + '">' + esc(safeEmail) + '</a>'
      : '<span>' + esc(safeEmail || "Invalid email address") + '</span>';
    return '<article class="panel inquiry-card"><div class="panel-head"><h2>' + esc(item.name) + '</h2><span class="badge ' + (item.status === "unread" ? "soon" : "") + '">' + esc(item.status || "unread") + '</span></div><p>' + emailMarkup + ' · ' + esc(item.topic) + (item.organization ? ' · ' + esc(item.organization) : "") + '</p><p>' + esc(item.message).replace(/\n/g, "<br>") + '</p><small>' + (item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time unavailable") + '</small><div class="form-actions">' + (item.status === "unread" ? '<button class="btn secondary small" data-inquiry-read="' + esc(item.id) + '">Mark read</button>' : "") + '<button class="btn danger small" data-inquiry-delete="' + esc(item.id) + '">Delete</button></div></article>';
  }).join("");
  host.querySelectorAll("[data-inquiry-read]").forEach(button => button.onclick = async () => { try { await update(ref(db, "inquiries/" + button.dataset.inquiryRead), { status: "read" }); } catch (error) { alert(friendly(error)); } });
  host.querySelectorAll("[data-inquiry-delete]").forEach(button => button.onclick = async () => { if (!confirm("Permanently delete this inquiry?")) return; try { await remove(ref(db, "inquiries/" + button.dataset.inquiryDelete)); } catch (error) { alert(friendly(error)); } });
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const attempts = getLoginAttempts();
  if (attempts.length >= loginMaxAttempts) {
    const waitMinutes = Math.max(1, Math.ceil((loginWindowMs - (Date.now() - attempts[0])) / 60000));
    say("Too many failed attempts. Please wait " + waitMinutes + " minute(s) before trying again.");
    return;
  }
  const button = document.getElementById("admin-signin");
  button.disabled = true;
  say("Signing in…");
  try {
    const emailVal = document.getElementById("admin-email").value.trim();
    const passVal = document.getElementById("admin-password").value;
    await signInWithEmailAndPassword(auth, emailVal, passVal);
    clearLoginAttempts();
    say("");
    loginForm.reset();
  } catch (error) {
    const recentAttempts = saveLoginAttempt();
    if (recentAttempts.length >= loginMaxAttempts) {
      say("Too many attempts. Login locked for 15 minutes.");
    } else {
      say(friendly(error) + " (Attempt " + recentAttempts.length + " of " + loginMaxAttempts + ")");
    }
  } finally {
    button.disabled = false;
  }
});

document.getElementById("admin-signout").addEventListener("click", async () => {
  if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  await signOut(auth);
  say("You have signed out.");
});

document.getElementById("publish-data").addEventListener("click", async event => {
  if (event.currentTarget.disabled) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Publishing…";
  setPublishStatus("pending", "Publishing latest website content…");
  setBanner("Publishing content…");

  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Your Firebase admin session expired. Sign in again before publishing.");
    await reload(user);
    await user.getIdToken(true);

    const isEmailAdmin = user.email && user.email.toLowerCase() === firebaseAdminEmail.toLowerCase();
    const isUidAdmin = user.uid === "6awoixuTaohonHNdQyWvAyeem112";
    if (!isEmailAdmin && !isUidAdmin) {
      throw new Error("This account is not authorized to publish changes.");
    }

    const draft = window.IMAANIX_ADMIN_GET_DRAFT();
    async function resolveImage(value, folder, id) {
      if (!String(value || "").startsWith("data:image/")) return value || "";
      setPublishStatus("pending", "Uploading images… This can take a little while.");
      try {
        const response = await fetch(value, { signal: AbortSignal.timeout(10000) });
        const blob = await response.blob();
        if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || blob.size > 5 * 1024 * 1024) {
          throw new Error("Images must be PNG, JPEG, or WEBP and smaller than 5 MB.");
        }
        const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.slice(6);
        const target = storageRef(storage, "public/" + folder + "/" + id + "." + ext);
        await withTimeout(uploadBytes(target, blob, { contentType: blob.type }), "Image upload", 15000);
        return await withTimeout(getDownloadURL(target), "Image URL lookup", 10000);
      } catch (storageErr) {
        console.warn("Storage upload note: using image directly in database", storageErr);
        return value || "";
      }
    }

    const products = await Promise.all((draft.products || []).map(async item => ({
      ...item,
      image: await resolveImage(item.image, "products", item.id)
    })));

    const productFeatures = {};
    for (const [productId, features] of Object.entries(draft.productFeatures || {})) {
      productFeatures[productId] = await Promise.all((features || []).map(async feature => ({
        ...feature,
        screens: await Promise.all((feature.screens || []).map(async screen => ({
          ...screen,
          image: await resolveImage(screen.image, "product-features/" + productId + "/" + feature.id, screen.id || "screen")
        })))
      })));
    }

    const productPages = {};
    for (const [productId, page] of Object.entries(draft.productPages || {})) {
      productPages[productId] = {
        ...page,
        heroImage: await resolveImage(page.heroImage, "product-pages/" + productId, "hero"),
        sections: await Promise.all((page.sections || []).map(async (section, index) => ({
          ...section,
          image: await resolveImage(section.image, "product-pages/" + productId, section.id || "section-" + index)
        })))
      };
    }

    const insights = await Promise.all((draft.insights || []).map(async item => ({
      ...item,
      image: await resolveImage(item.image, "insights", item.id)
    })));

    const publicContent = {
      site: draft.site || {},
      pages: draft.pages || {},
      products,
      productFeatures,
      productPages,
      insights,
      careers: draft.careers || [],
      socials: draft.socials || {},
      digitalTasbihSocials: draft.digitalTasbihSocials || {},
      updatedAt: Date.now()
    };

    setPublishStatus("pending", "Saving latest content to Firebase…");
    await withTimeout(set(ref(db, "publicContent"), publicContent), "Firebase publish");
    setBanner("Published to the website database.", true);
    setPublishStatus("success", "Successfully published to the website database. Changes are now live on the main website!");
    try {
      window.IMAANIX_ADMIN_IMPORT(publicContent);
    } catch (e) {
      console.warn("Local preview refresh note:", e);
    }
  } catch (error) {
    console.error("Imaanix publish failed", error);
    const detail = friendly(error);
    setBanner("Publish failed: " + detail);
    setPublishStatus("error", "Publish failed: " + detail);
  } finally {
    button.disabled = false;
    button.textContent = "Publish to site";
  }
});

onAuthStateChanged(auth, async user => {
  if (stopInbox) { stopInbox(); stopInbox = null; }
  if (stopBlockedIps) { stopBlockedIps(); stopBlockedIps = null; }
  if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }

  if (!user) {
    appPanel.hidden = true;
    gate.hidden = false;
    setBanner("Sign in required.");
    return;
  }
  try {
    await user.getIdToken(false);
  } catch (tokenErr) {
    await signOut(auth);
    appPanel.hidden = true;
    gate.hidden = false;
    say("Your session has expired. Please sign in again.");
    setBanner("Session expired. Please sign in.");
    return;
  }
  const isEmailAdmin = user.email && user.email.toLowerCase() === firebaseAdminEmail.toLowerCase();
  const isUidAdmin = user.uid === "6awoixuTaohonHNdQyWvAyeem112";
  if (!isEmailAdmin && !isUidAdmin) {
    await signOut(auth);
    appPanel.hidden = true;
    gate.hidden = false;
    say("This account is not authorized for this admin panel.");
    setBanner("Authorized admin account required.");
    return;
  }

  gate.hidden = true;
  appPanel.hidden = false;
  document.getElementById("admin-session-label").textContent = user.email || "Admin";
  setBanner("Signed in; loading protected website data…");
  resetInactivityTimer();

  onValue(ref(db, "publicContent"), snapshot => {
    if (snapshot.exists()) window.IMAANIX_ADMIN_IMPORT(snapshot.val());
    setBanner(snapshot.exists() ? "Signed in · live content loaded." : "Signed in · no published content yet.", true);
  }, error => setBanner(friendly(error)));

  stopBlockedIps = onValue(ref(db, "contactAbuse/blocked"), renderBlockedIps, error => {
    const el = document.getElementById("blocked-ips-list");
    if (el) el.textContent = friendly(error);
  });

  stopInbox = onValue(ref(db, "inquiries"), snapshot => {
    const rows = snapshot.exists()
      ? Object.entries(snapshot.val()).map(([id, item]) => ({ id, ...item })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      : [];
    showInbox(rows);
  }, error => {
    showInbox([]);
    setBanner(friendly(error));
  });
});
