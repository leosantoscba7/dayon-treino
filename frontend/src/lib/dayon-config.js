// DAYON - Treino: whether the Dayon cloud (Firebase Auth + Firestore, docs/dayon/PAINEL.md) is
// set up in this build, and the website flavour of the app.
//
// The Firebase web config comes from Vite env vars (frontend/.env.local, never committed;
// frontend/.env.example lists them). Missing or incomplete, firebaseConfig() is null: the app
// runs as it always did on this device, and "Sign in to Dayon" says it is not available.
const ENV = import.meta.env || {}
// Under test the real project is never contacted, whatever frontend/.env.local holds (Vitest
// loads it too): a test that wants a config passes one in.
const LIVE = ENV.MODE === 'test' ? {} : ENV

// The website build (npm run build:hosting): no self-hosted server, Dayon sign-in in front, and
// none of the licensed exercise media (lib/exercises.js).
export const CLOUD_SITE = ENV.VITE_DAYON_CLOUD === '1'

// Public source of this project (AGPL): a discreet "Source code" link on the website
// and in Settings → About points here. The original openGym repo stays credited separately.
export const SOURCE_CODE_URL = 'https://github.com/leosantoscba7/dayon-treino'
export const PRIVACY_URL = 'https://dayon---treino.web.app/privacy.html'

const KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
}
const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId']

/** The Firebase web config, or null when this build has none (or only part of one). */
export function firebaseConfig(env = LIVE) {
  const out = {}
  for (const [k, name] of Object.entries(KEYS)) {
    const v = typeof env[name] === 'string' ? env[name].trim() : ''
    if (v) out[k] = v
  }
  return REQUIRED.every(k => out[k]) ? out : null
}

export const dayonAvailable = (env = LIVE) => !!firebaseConfig(env)
