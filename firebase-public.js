import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getDatabase, onValue, push, ref, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { firebaseConfig, firebaseReady } from "./firebase-config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;
const formStatus = document.getElementById("contact-form-status");

// Client-side rate-limiting for public contact form (max 3 submissions per 15 minutes)
const INQUIRY_LIMIT_KEY = "imaanix_inquiry_submissions_v1";
const INQUIRY_WINDOW_MS = 15 * 60 * 1000;
const INQUIRY_MAX = 3;

function getInquirySubmissions() {
  try {
    const list = JSON.parse(sessionStorage.getItem(INQUIRY_LIMIT_KEY) || "[]");
    const now = Date.now();
    return Array.isArray(list) ? list.filter(t => Number.isFinite(t) && now - t < INQUIRY_WINDOW_MS) : [];
  } catch { return []; }
}
function recordInquirySubmission() {
  const list = [...getInquirySubmissions(), Date.now()];
  try { sessionStorage.setItem(INQUIRY_LIMIT_KEY, JSON.stringify(list)); } catch {}
}

if (!firebaseReady) {
  if (formStatus) formStatus.textContent = "The secure inbox is not configured yet.";
} else {
  try {
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    const api = window.IMAANIX || (window.IMAANIX = {});

    api.submitInquiry = async ({ name, email, organization, topic, message }) => {
      const submissions = getInquirySubmissions();
      if (submissions.length >= INQUIRY_MAX) {
        throw new Error("You have sent several messages recently. Please wait a few minutes before sending another.");
      }
      const safe = {
        name: String(name || "").trim().slice(0, 100),
        email: String(email || "").trim().slice(0, 254),
        organization: String(organization || "").trim().slice(0, 120),
        topic: String(topic || "").trim().slice(0, 60),
        message: String(message || "").trim().slice(0, 3000),
        createdAt: serverTimestamp(),
        status: "unread"
      };
      if (safe.name.length < 2 || !EMAIL_RE.test(safe.email) || safe.message.length < 10) {
        throw new Error("Please check the required fields.");
      }
      await push(ref(db, "inquiries"), safe);
      recordInquirySubmission();
    };

    onValue(ref(db, "publicContent"), snapshot => {
      if (snapshot.exists() && typeof window.IMAANIX_APPLY_PUBLIC === "function") {
        window.IMAANIX_APPLY_PUBLIC(snapshot.val());
      }
    }, error => {
      console.error("Imaanix public content could not be loaded:", error);
    });

    if (formStatus) formStatus.textContent = "We look forward to hearing from you.";
  } catch (error) {
    console.error("Firebase could not initialize:", error);
    if (formStatus) formStatus.textContent = "The secure inbox could not connect. Please try again later.";
  }
}
