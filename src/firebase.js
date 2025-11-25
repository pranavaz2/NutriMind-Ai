// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ⛔ Replace this object with the config from your Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyCra3FME_Px0_m5-9KLU-YzRS-wcI2_dUM",
  authDomain: "food-analyzer-5ff6c.firebaseapp.com",
  projectId: "food-analyzer-5ff6c",
  storageBucket: "food-analyzer-5ff6c.firebasestorage.app",
  messagingSenderId: "602320952990",
  appId: "1:602320952990:web:b434d761dd854cff8e658f",
  measurementId: "G-FT8YLNZ5B2"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
