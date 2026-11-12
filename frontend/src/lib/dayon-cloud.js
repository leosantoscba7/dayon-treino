// DAYON - Treino: the only place that talks to Firebase (Auth by email and password, Firestore).
// What is stored where, and the rules that guard it: docs/dayon/PAINEL.md, firestore.rules.
//
// The SDK is loaded on first use (dynamic import), so someone who never signs in to Dayon never
// downloads it. Only the modular web SDK's auth, firestore and app parts are used; nothing from
// @capacitor-firebase/messaging (lib/remote-push.js), whose web half would pull in more.
import { firebaseConfig } from './dayon-config.js'
import { DOC_VERSION, PLAN_DOC, ESTADO_DOC, readDoc, hashOf } from './dayon-model.js'

const fail = (code, message = code) => Object.assign(new Error(message), { code })
// A request that never settles (a captive portal, a phone between networks) counts as offline.
// Firestore keeps a write it could not send and sends it later on its own, which is harmless:
// the same content goes up again on the next sync anyway.
const TIMEOUT_MS = 20000
function timed(p, ms = TIMEOUT_MS) {
  let tm
  return Promise.race([p, new Promise((_, reject) => { tm = setTimeout(() => reject(fail('dayon/timeout')), ms) })])
    .finally(() => clearTimeout(tm))
}

let loading = null
/** { auth, db, A (firebase/auth), F (firebase/firestore) }, once. Throws 'dayon/unconfigured'. */
export function sdk() {
  if (loading) return loading
  const cfg = firebaseConfig()
  if (!cfg) return Promise.reject(fail('dayon/unconfigured'))
  loading = (async () => {
    const [{ initializeApp }, A, F] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])
    const app = initializeApp(cfg, 'dayon')
    // initializeAuth without a popup/redirect resolver: email and password only, and the iOS
    // WebView (capacitor://) cannot host Firebase's auth iframe anyway.
    const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] })
    const db = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
    return { auth, db, A, F }
  })()
  loading.catch(() => { loading = null })
  return loading
}

/** Calls `cb(user | null)` on every sign-in change. Returns the unsubscribe. */
export async function watchAuth(cb) {
  const { auth, A } = await sdk()
  return A.onAuthStateChanged(auth, cb)
}

const cleanEmail = e => String(e || '').trim()

// The profile every account has: born a student (firestore.rules users/{uid} create).
async function ensureProfile(user, nome) {
  const { db, F } = await sdk()
  const ref = F.doc(db, 'users', user.uid)
  const snap = await timed(F.getDoc(ref))
  if (snap.exists()) return snap.data()
  const data = { nome: String(nome || user.displayName || '').slice(0, 80), papel: 'aluno', email: user.email, criadoEm: F.serverTimestamp(), atualizadoEm: F.serverTimestamp() }
  await timed(F.setDoc(ref, data))
  return { ...data, criadoEm: null, atualizadoEm: null }
}

export async function criarConta({ nome, email, senha }) {
  if (!cleanEmail(email) || !senha) throw fail('dayon/missing-fields')
  const { auth, A } = await sdk()
  const { user } = await timed(A.createUserWithEmailAndPassword(auth, cleanEmail(email), senha))
  if (nome) await A.updateProfile(user, { displayName: String(nome).slice(0, 80) }).catch(() => {})
  const perfil = await ensureProfile(user, nome)
  return { user, perfil }
}

export async function entrar({ email, senha }) {
  if (!cleanEmail(email) || !senha) throw fail('dayon/missing-fields')
  const { auth, A } = await sdk()
  const { user } = await timed(A.signInWithEmailAndPassword(auth, cleanEmail(email), senha))
  // A profile whose first write never landed (the account was made offline) is made now.
  const perfil = await ensureProfile(user)
  return { user, perfil }
}

export async function sair() {
  const { auth, A } = await sdk()
  await A.signOut(auth)
}

export async function esqueciSenha(email) {
  if (!cleanEmail(email)) throw fail('auth/invalid-email')
  const { auth, A } = await sdk()
  await timed(A.sendPasswordResetEmail(auth, cleanEmail(email)))
}

export async function lerPerfil(uid) {
  const { db, F } = await sdk()
  const snap = await timed(F.getDoc(F.doc(db, 'users', uid)))
  return snap.exists() ? snap.data() : null
}

const millis = ts => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0)

/**
 * What the cloud holds for `uid`: the plan, the rest, and the workouts written after `since`
 * (ms; all of them when null). { plan, estado, workouts: [{ id, w }], since } with `since` the
 * newest write time read, for the next call.
 */
export async function lerNuvem(uid, since = null) {
  const { db, F } = await sdk()
  const col = F.collection(db, 'users', uid, 'workouts')
  const q = since ? F.query(col, F.where('atualizadoEm', '>', F.Timestamp.fromMillis(since))) : col
  const [p, e, ws] = await timed(Promise.all([
    F.getDoc(F.doc(db, 'users', uid, 'plan', PLAN_DOC)),
    F.getDoc(F.doc(db, 'users', uid, 'estado', ESTADO_DOC)),
    F.getDocs(q),
  ]))
  let newest = since || 0
  const workouts = []
  for (const d of ws.docs) {
    const data = d.data()
    newest = Math.max(newest, millis(data.atualizadoEm))
    const w = readDoc(data)
    if (w) workouts.push({ id: d.id, w })
  }
  return {
    plan: p.exists() ? readDoc(p.data()) : null,
    // Who wrote the plan last (a trainer, or the student): the "updated by your trainer" note.
    planPor: p.exists() ? p.data().por || null : null,
    estado: e.exists() ? readDoc(e.data()) : null,
    workouts,
    since: newest || null,
  }
}

// Who is signed in: `por` on every write is that person (firestore.rules dataDoc), which is not
// the uid in the path when a trainer saves a student's plan.
async function signedInUid() {
  const { auth } = await sdk()
  const me = auth.currentUser?.uid
  if (!me) throw fail('dayon/signed-out')
  return me
}

const BATCH = 400   // Firestore takes up to 500 writes in one batch

/**
 * Writes what lib/dayon-model.js planWrites found. The plan and the rest go in one transaction
 * that first checks the plan is still the one this device merged with (`expectPlan`, its hash):
 * a trainer who saved the plan in between makes it fail with 'dayon/conflict', and the next sync
 * merges their change in instead of writing over it. The workouts follow in batches.
 */
export async function gravarNuvem(uid, writes, { expectPlan = null, expectEstado = null } = {}) {
  const { db, F } = await sdk()
  const por = await signedInUid()
  const docData = (json, extra = {}) => ({ v: DOC_VERSION, json, ts: Date.now(), atualizadoEm: F.serverTimestamp(), por, ...extra })
  if (writes.plan || writes.estado) {
    const planRef = F.doc(db, 'users', uid, 'plan', PLAN_DOC)
    const estadoRef = F.doc(db, 'users', uid, 'estado', ESTADO_DOC)
    await timed(F.runTransaction(db, async tx => {
      const [p, e] = await Promise.all([tx.get(planRef), tx.get(estadoRef)])
      const now = d => { const c = d.exists() ? readDoc(d.data()) : null; return c ? hashOf(c) : null }
      if (now(p) !== expectPlan || now(e) !== expectEstado) throw fail('dayon/conflict')
      if (writes.plan) tx.set(planRef, docData(writes.plan.json))
      if (writes.estado) tx.set(estadoRef, docData(writes.estado.json))
    }))
  }
  const ops = [
    ...writes.upserts.map(u => b => b.set(F.doc(db, 'users', uid, 'workouts', u.id), docData(u.json, { d: String(u.w?.d || '') }))),
    ...writes.deletes.map(id => b => b.delete(F.doc(db, 'users', uid, 'workouts', id))),
  ]
  for (let i = 0; i < ops.length; i += BATCH) {
    const b = F.writeBatch(db)
    for (const op of ops.slice(i, i + BATCH)) op(b)
    await timed(b.commit())
  }
}

// ---- Trainers and their students (firestore.rules, docs/dayon/PAINEL.md) ---------------------

/** A code nobody guesses: 12 letters and digits without look-alikes (no 0/O, 1/I/L). */
export function novoCodigo(rand = n => crypto.getRandomValues(new Uint32Array(n))) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from(rand(12), x => abc[x % abc.length]).join('').replace(/(.{4})(?=.)/g, '$1-')
}
export const limparCodigo = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '')
// A trainer code is the id of a doc Léo makes by hand in the Console, and Firestore ids are
// case-sensitive: it is used as typed (only spaces and line breaks go, from a copy and paste).
// Upper-casing it, as the student codes are, turned a mixed-case code into a doc that does not
// exist, and "Use" silently said no (QA on the test website, 11/11/2026).
export const limparCodigoPersonal = c => String(c || '').replace(/\s+/g, '')

/**
 * Redeems a trainer code (made by hand in the Console) and becomes a trainer, in one batch.
 * The code is looked up as typed and, failing that, in capitals (a phone keyboard that
 * capitalised it, or a code Léo made in capitals). Errors: 'dayon/invalid-code' (no such code,
 * turned off or already used), 'dayon/already-trainer', or Firestore's own ('permission-denied'
 * when the rules refuse a code that is free, 'unavailable'... when offline): never swallowed.
 */
export async function tornarPersonal(uid, codigo) {
  const typed = limparCodigoPersonal(codigo)
  if (!typed) throw fail('dayon/invalid-code')
  const { db, F } = await sdk()
  const perfil = await timed(F.getDoc(F.doc(db, 'users', uid)))
  if (perfil.exists() && perfil.data().papel === 'personal') throw fail('dayon/already-trainer')
  let ref = null
  let c = null
  for (const code of [...new Set([typed, typed.toUpperCase()])]) {
    const r = F.doc(db, 'convitesPersonal', code)
    const snap = await timed(F.getDoc(r))
    if (snap.exists()) { ref = r; c = snap.data(); break }
  }
  const livre = x => !!x && x.ativo === true && x.usadoPor == null
  if (!livre(c)) throw fail('dayon/invalid-code')
  const b = F.writeBatch(db)
  b.update(ref, { ativo: false, usadoPor: uid, usadoEm: F.serverTimestamp() })
  b.update(F.doc(db, 'users', uid), { papel: 'personal', conviteUsado: ref.id, atualizadoEm: F.serverTimestamp() })
  try { await timed(b.commit()) }
  catch (e) {
    if (e?.code !== 'permission-denied') throw e
    // Someone used it in between: say so. A code still free that the rules refused is not the
    // person's fault, and saying "invalid code" then hid the real problem.
    const again = await timed(F.getDoc(ref)).catch(() => null)
    throw again && !livre(again.exists() ? again.data() : null) ? fail('dayon/invalid-code') : e
  }
}

/** A trainer makes a one-time code for a student. Returns the code. */
export async function criarConviteAluno(uid, nome) {
  const { db, F } = await sdk()
  const code = novoCodigo()
  await timed(F.setDoc(F.doc(db, 'convitesAluno', code), {
    personalId: uid, personalNome: String(nome || '').slice(0, 80), ativo: true, usadoPor: null, usadoEm: null, criadoEm: F.serverTimestamp(),
  }))
  return code
}

/** A student redeems a trainer's code: the link (vinculos/{personalId_alunoId}) is active at once. */
export async function ligarAoPersonal(uid, codigo) {
  const code = limparCodigo(codigo)
  if (!code) throw fail('dayon/invalid-code')
  const { db, F } = await sdk()
  const ref = F.doc(db, 'convitesAluno', code)
  const snap = await timed(F.getDoc(ref))
  const c = snap.exists() ? snap.data() : null
  if (!c || c.ativo !== true || c.usadoPor != null || !c.personalId) throw fail('dayon/invalid-code')
  if (c.personalId === uid) throw fail('dayon/own-code')
  const vRef = F.doc(db, 'vinculos', `${c.personalId}_${uid}`)
  const v = await timed(F.getDoc(vRef))
  const b = F.writeBatch(db)
  b.update(ref, { ativo: false, usadoPor: uid, usadoEm: F.serverTimestamp() })
  if (v.exists()) b.update(vRef, { status: 'ativo', conviteUsado: code, atualizadoEm: F.serverTimestamp() })
  else b.set(vRef, { personalId: c.personalId, alunoId: uid, status: 'ativo', conviteUsado: code, criadoEm: F.serverTimestamp(), atualizadoEm: F.serverTimestamp() })
  try { await timed(b.commit()) }
  catch (e) { throw e?.code === 'permission-denied' ? fail('dayon/invalid-code') : e }
  return { personalNome: c.personalNome || '' }
}

/** The links of `uid`, as student and as trainer (each query filtered by `uid`, as the rules want). */
export async function meusVinculos(uid) {
  const { db, F } = await sdk()
  const col = F.collection(db, 'vinculos')
  const [a, p] = await timed(Promise.all([
    F.getDocs(F.query(col, F.where('alunoId', '==', uid))),
    F.getDocs(F.query(col, F.where('personalId', '==', uid))),
  ]))
  const rows = s => s.docs.map(d => ({ id: d.id, ...d.data() }))
  return { comoAluno: rows(a), comoPersonal: rows(p) }
}

/** Someone's name from their profile, or null when the rules refuse it (no active link). */
export async function nomeDe(uid) {
  try { return (await lerPerfil(uid))?.nome || null } catch { return null }
}

/** A trainer's open student codes (made, not used, not cancelled), newest first. */
export async function convitesAbertos(uid) {
  const { db, F } = await sdk()
  const s = await timed(F.getDocs(F.query(F.collection(db, 'convitesAluno'), F.where('personalId', '==', uid))))
  return s.docs.map(d => ({ codigo: d.id, ...d.data() }))
    .filter(c => c.ativo === true && c.usadoPor == null)
    .sort((a, b) => millis(b.criadoEm) - millis(a.criadoEm))
}

/** A trainer cancels a code nobody used yet (the rules let only `ativo` change). */
export async function cancelarConviteAluno(codigo) {
  const { db, F } = await sdk()
  await timed(F.updateDoc(F.doc(db, 'convitesAluno', limparCodigo(codigo)), { ativo: false }))
}

/** The student or the trainer ends a link: no access either way from then on. */
export async function encerrarVinculo(personalId, alunoId) {
  const { db, F } = await sdk()
  await timed(F.updateDoc(F.doc(db, 'vinculos', `${personalId}_${alunoId}`), { status: 'encerrado', atualizadoEm: F.serverTimestamp() }))
}

/** The day of a student's newest workout ('YYYY-MM-DD'), or null: one document read, not the history. */
export async function ultimoTreino(alunoId) {
  const { db, F } = await sdk()
  const s = await timed(F.getDocs(F.query(F.collection(db, 'users', alunoId, 'workouts'), F.orderBy('d', 'desc'), F.limit(1))))
  const d = s.docs[0]?.data()
  return d ? String(d.d || '') || null : null
}

/**
 * A page of a student's history, newest first, for the trainer to read: { workouts: [w], next }.
 * `next` is handed back for the page after it (null at the end). Read only: the rules refuse a
 * trainer's write to the workouts.
 */
export async function lerTreinosAluno(alunoId, { limite = 30, depois = null } = {}) {
  const { db, F } = await sdk()
  const parts = [F.orderBy('d', 'desc')]
  if (depois) parts.push(F.startAfter(depois))
  parts.push(F.limit(limite))
  const s = await timed(F.getDocs(F.query(F.collection(db, 'users', alunoId, 'workouts'), ...parts)))
  const workouts = s.docs.map(d => readDoc(d.data())).filter(Boolean)
  return { workouts, next: s.docs.length === limite ? s.docs[s.docs.length - 1] : null }
}

/** A student's plan, for the trainer (the rules let a trainer read only this and the workouts). */
export async function lerPlanoAluno(alunoId) {
  const { db, F } = await sdk()
  const p = await timed(F.getDoc(F.doc(db, 'users', alunoId, 'plan', PLAN_DOC)))
  return { plan: p.exists() ? readDoc(p.data()) : null }
}

/**
 * A trainer saves a student's plan: only users/{alunoId}/plan/atual, in a transaction that fails
 * with 'dayon/conflict' when the plan is no longer the one this edit started from (`expectPlan`,
 * its hash; null for none), so the student's own change in between is merged, not written over.
 */
export async function gravarPlanoAluno(alunoId, json, expectPlan = null) {
  const { db, F } = await sdk()
  const por = await signedInUid()
  const ref = F.doc(db, 'users', alunoId, 'plan', PLAN_DOC)
  await timed(F.runTransaction(db, async tx => {
    const p = await tx.get(ref)
    const c = p.exists() ? readDoc(p.data()) : null
    if ((c ? hashOf(c) : null) !== expectPlan) throw fail('dayon/conflict')
    tx.set(ref, { v: DOC_VERSION, json, ts: Date.now(), atualizadoEm: F.serverTimestamp(), por })
  }))
}

// ---- Deleting the account (Apple 5.1.1(v); docs/dayon/PAINEL.md, "Apagar conta") ------------

const DELETE_PAGE = 500   // Firestore takes up to 500 writes in one batch

/**
 * Deletes the signed-in Dayon account and everything of it in the cloud, in this order:
 * reauthenticate with the password (Firebase wants a recent sign-in, and it proves it is the
 * owner holding the phone); users/{uid}/workouts, plan and estado, page by page; the links where
 * this person is the student or the trainer; the student codes this person made; users/{uid};
 * and only then the Auth account. A Firestore step that fails stops there and throws, with the
 * Auth account still in place, so "Delete" can simply be tried again: what was already deleted
 * is not there to find the second time. convitesPersonal is left alone (the rules let only Léo
 * delete it, in the Console); a used one only names the uid.
 */
export async function apagarConta(senha) {
  if (!senha) throw fail('auth/missing-password')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw fail('dayon/offline')
  const { auth, db, A, F } = await sdk()
  const user = auth.currentUser
  if (!user || !user.email) throw fail('dayon/signed-out')
  await timed(A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, senha)))
  const uid = user.uid
  const deleteAll = async refs => {
    for (let i = 0; i < refs.length; i += DELETE_PAGE) {
      const b = F.writeBatch(db)
      for (const r of refs.slice(i, i + DELETE_PAGE)) b.delete(r)
      await timed(b.commit())
    }
  }
  // A page at a time: a deleted document no longer matches, so the same query reads the next page.
  const drain = async q => {
    for (;;) {
      const s = await timed(F.getDocs(F.query(q, F.limit(DELETE_PAGE))))
      if (!s.docs.length) return
      await deleteAll(s.docs.map(d => d.ref))
      if (s.docs.length < DELETE_PAGE) return
    }
  }
  for (const sub of ['workouts', 'plan', 'estado']) await drain(F.collection(db, 'users', uid, sub))
  const vinculos = F.collection(db, 'vinculos')
  await drain(F.query(vinculos, F.where('alunoId', '==', uid)))
  await drain(F.query(vinculos, F.where('personalId', '==', uid)))
  await drain(F.query(F.collection(db, 'convitesAluno'), F.where('personalId', '==', uid)))
  await timed(F.deleteDoc(F.doc(db, 'users', uid)))
  await timed(A.deleteUser(user))
}
