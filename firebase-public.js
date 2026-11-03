import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getDatabase, onValue, push, ref, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { firebaseConfig, firebaseReady } from "./firebase-config.js";

const formStatus = document.getElementById("contact-form-status");
if (!firebaseReady) {
  if (formStatus) formStatus.textContent = "The secure inbox is not configured yet.";
} else {
  try {
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    const api = window.IMAANIX || (window.IMAANIX = {});
    api.submitInquiry = async ({ name, email, organization, topic, message }) => {
      const safe = {
        name: String(name || "").trim().slice(0, 100),
        email: String(email || "").trim().slice(0, 254),
        organization: String(organization || "").trim().slice(0, 120),
        topic: String(topic || "").trim().slice(0, 60),
        message: String(message || "").trim().slice(0, 3000),
        createdAt: serverTimestamp(),
        status: "unread"
      };
      if (safe.name.length < 2 || safe.email.length < 5 || safe.topic.length < 2 || safe.message.length < 10) {
        throw new Error("Please check the required fields.");
      }
      await push(ref(db, "inquiries"), safe);
    };

    onValue(ref(db, "publicContent"), snapshot => {
      if (snapshot.exists() && typeof window.IMAANIX_APPLY_PUBLIC === "function") {
        window.IMAANIX_APPLY_PUBLIC(snapshot.val());
      }
    }, error => {
      console.error("Imaanix public content could not be loaded:", error);
    });
    if (formStatus) formStatus.textContent = "Your message will be sent to the Imaanix admin inbox.";
  } catch (error) {
    console.error("Firebase could not initialize:", error);
    if (formStatus) formStatus.textContent = "The secure inbox could not connect. Please try again later.";
  }
}
