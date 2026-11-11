/* DAYON - Treino: a trainer working on a student's plan (docs/dayon/PAINEL.md, etapa 3).
 *
 * The plan screens (views/Plan.jsx, views/RoutineEdit.jsx and the sheets they open) read and
 * write the store's one copy, `S`. To use them on a student's plan without touching the trainer's
 * own data, the store shows a stand-in copy meanwhile (useStore enterTourSandbox: nothing of it
 * is saved, mirrored or synced) built here: the trainer's own copy, so the screens keep the
 * trainer's language, theme and settings, with every plan field (lib/dayon-model.js PLAN_FIELDS)
 * swapped for the student's, and no workouts at all. Saving takes only the plan part of it back
 * out (splitState) and writes it to users/{alunoId}/plan/atual; the student's history and the
 * rest of the student's data are never read into it nor written.
 *
 * Pure: the cloud comes in as an argument (lib/dayon-cloud.js in the app, a stand-in in tests).
 */
import { PLAN_FIELDS, MAX_JSON, splitState, composeCloud, mergeCloud, hashOf } from './dayon-model.js'

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const fail = code => Object.assign(new Error(code), { code })
const ATTEMPTS = 3

/**
 * The stand-in copy: `real` (the trainer's own) with the student's `plan` (the document's
 * content, or null when the student has none yet) in place of every plan field. `defaults`
 * fills a field the student's plan lacks (the store's DEF). Never changes `real`.
 */
export function studentCopy(real, plan, defaults = {}) {
  const S = clone(real) || {}
  const p = isMap(plan) ? plan : {}
  for (const k of PLAN_FIELDS) {
    if (k in p) S[k] = clone(p[k])
    else if (k in defaults) S[k] = clone(defaults[k])
    else delete S[k]
  }
  // The student's weights are in the student's unit; the screens show them in it.
  S.unit = p.unit || defaults.unit || S.unit
  if (p.unitSet) S.unitSet = clone(p.unitSet); else delete S.unitSet
  // Only the plan's own edit stamps: they decide, in the student's merge, which side edited last.
  for (const f of ['edited', 'undone', 'deleted']) {
    if (isMap(p[f])) S[f] = clone(p[f]); else delete S[f]
  }
  S._ts = Number(p._ts) || 0
  S.workouts = []
  S.active = null
  delete S.resetAt
  delete S.resetIds
  return S
}

/** The plan document's content in `S`. */
export const planPart = S => splitState(S).plan

/** Whether the plan in `S` differs from the one in `start` (both stand-in copies). */
export const planChanged = (start, S) => hashOf(planPart(start)) !== hashOf(planPart(S))

/**
 * Saves the plan in `edited` for `alunoId`. `basePlan` is the plan as it was read when the edit
 * began (null for none). The write fails when the student (or another device) saved the plan in
 * between; then the plan is read again, merged with this edit by the app's own field stamps
 * (mergeCloud), and written over that one. `cloud` is { readPlan(alunoId) → { plan },
 * writePlan(alunoId, json, expectHash) }. Resolves { merged } (whether a merge was needed).
 */
export async function savePlan({ alunoId, edited, basePlan = null, cloud }) {
  let expect = basePlan ? hashOf(basePlan) : null
  let mine = edited
  let merged = false
  let last = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const json = JSON.stringify(planPart(mine))
    if (json.length > MAX_JSON) throw fail('dayon/too-big')
    try {
      await cloud.writePlan(alunoId, json, expect)
      return { merged }
    } catch (e) {
      if (e?.code !== 'dayon/conflict') throw e
      last = e
      const { plan } = await cloud.readPlan(alunoId)
      const theirs = composeCloud(mine, { plan })
      mine = theirs ? mergeCloud(mine, theirs) : mine
      expect = plan ? hashOf(plan) : null
      merged = true
    }
  }
  throw last || fail('dayon/conflict')
}

/** The trainer's list: active students first, then by name; each with its status. */
export function studentRows(vinculos = [], names = {}, last = {}) {
  const rank = s => (s === 'ativo' ? 0 : s === 'pendente' ? 1 : 2)
  return vinculos
    .filter(v => v && v.alunoId)
    .map(v => ({ alunoId: v.alunoId, status: v.status || 'pendente', nome: names[v.alunoId] || '', ultimo: last[v.alunoId] ?? null }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.nome.localeCompare(b.nome) || a.alunoId.localeCompare(b.alunoId))
}

/* The names seen before, kept on this device: once a link ends the rules no longer let anyone
   read the other's profile, and the list should still say who it was. */
const NAMES_KEY = 'dayon_nomes'
export function readNames(storage) {
  try { const m = JSON.parse(storage?.getItem(NAMES_KEY) || 'null'); return isMap(m) ? m : {} } catch { return {} }
}
export function rememberNames(storage, names) {
  const known = readNames(storage)
  let changed = false
  for (const [k, v] of Object.entries(names || {})) if (v && known[k] !== v) { known[k] = v; changed = true }
  if (changed) { try { storage?.setItem(NAMES_KEY, JSON.stringify(known)) } catch { /* full: names are fetched again */ } }
  return known
}
