import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getDatabase, onValue, ref, set, remove, update } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-storage.js";
import { firebaseConfig, firebaseAdminEmail } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);
const gate = document.getElementById("auth-gate");
const appPanel = document.getElementById("admin-app");
const message = document.getElementById("auth-message");
const banner = document.getElementById("admin-status-banner");
const loginForm = document.getElementById("admin-login-form");
let stopInbox = null;

function say(text) { if (message) message.textContent = text; }
function setBanner(text, connected = false) {
  const label = document.createElement("b");
  label.textContent = "Firebase admin:";
  banner.replaceChildren(label, document.createTextNode(" " + text));
  banner.classList.toggle("connected", connected);
}
function friendly(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Email or password is incorrect.";
  if (code.includes("user-not-found")) return "This email does not have a Firebase Authentication account.";
  if (code.includes("network-request-failed")) return "Network error. Check your connection and try again.";
  if (code.includes("permission-denied")) return "Firebase denied access. Deploy the supplied RTDB and Storage rules, and verify this admin email.";
  return error?.message || "Firebase request failed.";
}
function showInbox(items) {
  const host = document.getElementById("inquiries-list");
  const count = document.getElementById("inquiries-count");
  if (!host) return;
  if (count) count.textContent = items.length + " message" + (items.length === 1 ? "" : "s");
  if (!items.length) { host.innerHTML = '<div class="empty">No inquiries yet. New website messages will appear here.</div>'; return; }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  host.innerHTML = items.map(item => '<article class="panel inquiry-card"><div class="panel-head"><h2>' + esc(item.name) + '</h2><span class="badge ' + (item.status === "unread" ? "soon" : "") + '">' + esc(item.status || "unread") + '</span></div><p><a href="mailto:' + esc(item.email) + '">' + esc(item.email) + '</a> · ' + esc(item.topic) + (item.organization ? ' · ' + esc(item.organization) : "") + '</p><p>' + esc(item.message).replace(/\n/g, "<br>") + '</p><small>' + (item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time unavailable") + '</small><div class="form-actions">' + (item.status === "unread" ? '<button class="btn secondary small" data-inquiry-read="' + esc(item.id) + '">Mark read</button>' : "") + '<button class="btn danger small" data-inquiry-delete="' + esc(item.id) + '">Delete</button></div></article>').join("");
  host.querySelectorAll("[data-inquiry-read]").forEach(button => button.onclick = async () => { try { await update(ref(db, "inquiries/" + button.dataset.inquiryRead), { status: "read" }); } catch (error) { alert(friendly(error)); } });
  host.querySelectorAll("[data-inquiry-delete]").forEach(button => button.onclick = async () => { if (!confirm("Permanently delete this inquiry?")) return; try { await remove(ref(db, "inquiries/" + button.dataset.inquiryDelete)); } catch (error) { alert(friendly(error)); } });
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("admin-signin"); button.disabled = true; say("Signing in…");
  try {
    await signInWithEmailAndPassword(auth, firebaseAdminEmail, document.getElementById("admin-password").value);
  } catch (error) { say(friendly(error)); }
  finally { button.disabled = false; }
});
document.getElementById("admin-reset").addEventListener("click", async () => {
  try { await sendPasswordResetEmail(auth, firebaseAdminEmail); say("Password reset email sent to " + firebaseAdminEmail + "."); }
  catch (error) { say(friendly(error)); }
});
document.getElementById("admin-signout").addEventListener("click", () => signOut(auth));
document.getElementById("publish-data").addEventListener("click", async event => {
  const button = event.currentTarget; button.disabled = true; setBanner("Publishing content…");
  try {
    const draft = window.IMAANIX_ADMIN_GET_DRAFT();
    async function resolveImage(value, folder, id) {
      if (!String(value || "").startsWith("data:image/")) return value || "";
      const response = await fetch(value); const blob = await response.blob();
      if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error("Images must be PNG, JPEG, or WEBP and smaller than 5 MB.");
      const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.slice(6);
      const target = storageRef(storage, "public/" + folder + "/" + id + "." + ext);
      await uploadBytes(target, blob, { contentType: blob.type }); return await getDownloadURL(target);
    }
    const products = await Promise.all(draft.products.map(async item => ({ ...item, image: await resolveImage(item.image, "products", item.id) })));
    const insights = await Promise.all(draft.insights.map(async item => ({ ...item, image: await resolveImage(item.image, "insights", item.id) })));
    const publicContent = { site: draft.site, products, insights, careers: draft.careers, socials: draft.socials, updatedAt: Date.now() };
    await set(ref(db, "publicContent"), publicContent);
    window.IMAANIX_ADMIN_IMPORT(publicContent);
    setBanner("Published to the website database.", true);
    alert("Website content published successfully.");
  } catch (error) { setBanner(friendly(error)); alert("Publish failed: " + friendly(error)); }
  finally { button.disabled = false; }
});

onAuthStateChanged(auth, async user => {
  if (stopInbox) { stopInbox(); stopInbox = null; }
  if (!user) { appPanel.hidden = true; gate.hidden = false; setBanner("Sign in required."); return; }
  if (user.email?.toLowerCase() !== firebaseAdminEmail.toLowerCase() || !user.emailVerified) {
    await signOut(auth); appPanel.hidden = true; gate.hidden = false;
    say(user.emailVerified ? "This account is not authorized for this admin panel." : "Verify this email address in Firebase Authentication before using admin.");
    setBanner("Admin email verification required."); return;
  }
  gate.hidden = true; appPanel.hidden = false;
  document.getElementById("admin-session-label").textContent = user.email;
  setBanner("Signed in; loading protected website data…");
  onValue(ref(db, "publicContent"), snapshot => {
    if (snapshot.exists()) window.IMAANIX_ADMIN_IMPORT(snapshot.val());
    setBanner(snapshot.exists() ? "Signed in · live content loaded." : "Signed in · no published content yet.", true);
  }, error => setBanner(friendly(error)));
  stopInbox = onValue(ref(db, "inquiries"), snapshot => {
    const rows = snapshot.exists() ? Object.entries(snapshot.val()).map(([id, item]) => ({ id, ...item })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
    showInbox(rows);
  }, error => { showInbox([]); setBanner(friendly(error)); });
});
