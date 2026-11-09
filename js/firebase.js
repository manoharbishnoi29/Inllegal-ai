import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import * as fs from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';

export const configured =
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_') && !!firebaseConfig.projectId && !firebaseConfig.projectId.startsWith('YOUR_');

// Alag app naam: admin site aur user site ek hi domain par hain, isliye login session mix na ho.
export const app = configured ? initializeApp(firebaseConfig, 'illegal-user') : null;
export const db = app ? fs.getFirestore(app) : null;
export { fs };
