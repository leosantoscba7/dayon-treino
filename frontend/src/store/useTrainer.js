// DAYON - Treino: a trainer editing a student's plan with the app's own plan screens
// (docs/dayon/PAINEL.md, etapa 3). The store shows a stand-in copy meanwhile (useStore
// enterTourSandbox), which is never saved, mirrored or synced, so the trainer's own plan and
// history on this device stay exactly as they were; only the student's plan goes up, to
// users/{alunoId}/plan/atual (lib/dayon-trainer.js savePlan).
import { create } from 'zustand'
import { useStore, DEF } from './useStore.js'
import { registerCustom } from '../lib/exercises.js'
import { studentCopy, planChanged, savePlan } from '../lib/dayon-trainer.js'

const cloudApi = () => import('../lib/dayon-cloud.js')

export const useTrainer = create((set, get) => {
  // The stand-in copy went away under the editor (the tour started, another tab signed out):
  // the edit goes with it, and the bar says nothing more.
  let watching = false
  const watch = () => {
    if (watching) return
    watching = true
    useStore.subscribe((s, prev) => {
      if (prev.tourSandbox && !s.tourSandbox && get().editing) set({ editing: null, saving: false })
    })
  }
  const leave = () => {
    set({ editing: null, saving: false })
    if (useStore.getState().tourSandbox) useStore.getState().leaveTourSandbox()
  }

  return {
    // { alunoId, nome, basePlan, start } while a student's plan is on screen; null otherwise.
    editing: null,
    saving: false,

    /** Reads the student's plan and puts it on the plan screens. False when something else
     *  (the tour) holds the stand-in copy already. */
    async open({ alunoId, nome }) {
      if (get().editing || useStore.getState().tourSandbox) return false
      const { plan } = await (await cloudApi()).lerPlanoAluno(alunoId)
      // A sandbox may have come up while the plan was on its way.
      if (get().editing || useStore.getState().tourSandbox) return false
      watch()
      const copy = studentCopy(useStore.getState().S, plan, DEF)
      useStore.getState().enterTourSandbox(S => {
        for (const k of Object.keys(S)) delete S[k]
        Object.assign(S, copy)
      })
      // The student's own exercises, so the screens name them (put back on leave).
      registerCustom(useStore.getState().S.customEx)
      set({ editing: { alunoId, nome: nome || '', basePlan: plan, start: copy } })
      return true
    },

    /** Whether the plan on screen differs from the one the edit started from. */
    dirty() {
      const e = get().editing
      return !!e && useStore.getState().tourSandbox && planChanged(e.start, useStore.getState().S)
    },

    /** Writes the student's plan (when it changed) and hands the trainer's own copy back.
     *  Throws what the cloud threw; the edit then stays on screen to try again. */
    async save() {
      const e = get().editing
      if (!e || get().saving) return { saved: false }
      if (!get().dirty()) { leave(); return { saved: false } }
      set({ saving: true })
      try {
        const c = await cloudApi()
        const r = await savePlan({
          alunoId: e.alunoId, edited: useStore.getState().S, basePlan: e.basePlan,
          cloud: { readPlan: c.lerPlanoAluno, writePlan: c.gravarPlanoAluno },
        })
        leave()
        return { saved: true, ...r }
      } catch (err) {
        set({ saving: false })
        throw err
      }
    },

    /** Leaves without saving: the edit is dropped, the trainer's copy comes back as it was. */
    discard() { if (get().editing) leave() },
  }
})
