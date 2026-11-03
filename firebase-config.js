// Firebase web app settings are public identifiers. Protect data with Firebase Security Rules.
// Firebase web app settings are public identifiers. Protect data with Firebase Security Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyDYSQ5lqGKXDvsoOAjaGy_4zpwlS1tLAu0",
  authDomain: "imaanix.firebaseapp.com",
  databaseURL: "https://imaanix-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "imaanix",
  storageBucket: "imaanix.firebasestorage.app",
  messagingSenderId: "482010509902",
  appId: "1:482010509902:web:9fa44c49391a01f4bf091f",
  measurementId: "G-K6BHGHWVFN"
};

export const firebaseAdminEmail = "iimaanix@gmail.com";

export const firebaseReady = Boolean(
  firebaseConfig.databaseURL && firebaseAdminEmail
);
