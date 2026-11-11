// DAYON - Treino: while a trainer edits a student's plan (store/useTrainer.js), this bar stays
// pinned at the top of every screen: whose plan is on screen, Save and Leave. It takes the place
// of the connection bar meanwhile (SyncBanner steps aside) and its room the same way (--conn).
import { useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrainer } from '../store/useTrainer.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dayonMessage } from '../lib/dayon-errors.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)

export default function StudentPlanBar() {
  const nav = useNavigate()
  const editing = useTrainer(s => s.editing)
  const saving = useTrainer(s => s.saving)
  const row = useRef(null)
  const show = !!editing

  useLayoutEffect(() => {
    const root = document.documentElement
    const el = row.current
    if (!show || !el) return
    const fit = () => root.style.setProperty('--conn', el.offsetHeight + 'px')
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--conn') }
  }, [show])

  if (!show) return null
  const back = () => nav('/trainer/' + encodeURIComponent(editing.alunoId))
  const save = async () => {
    try {
      const r = await useTrainer.getState().save()
      toast(r.saved ? t('Plan saved for {0}', editing.nome) : t('No changes to save'))
      back()
    } catch (e) { toast(dayonMessage(e)) }
  }
  const leave = () => {
    if (!useTrainer.getState().dirty()) { useTrainer.getState().discard(); back(); return }
    confirmSheet({
      title: t('Leave without saving?'),
      message: t('The changes to {0}’s plan are lost. Your own plan stays as it is.', editing.nome),
      confirmText: t('Leave without saving'),
      cancelText: t('Keep editing'),
      danger: true,
      onConfirm: () => { useTrainer.getState().discard(); back() },
    })
  }
  return <div className="conn-bar dayon-edit">
    <div className="conn-row" ref={row} role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div className="conn" style={{ flex: 1, minWidth: 0 }}>
        <Icon name="pencil" />
        <span className="conn-t">{t('Editing {0}’s plan', editing.nome)}</span>
      </div>
      <button type="button" className="conn-a" onClick={leave} disabled={saving}>{t('Leave')}</button>
      <button type="button" className="conn-a dayon-edit-save" onClick={save} disabled={saving}>{saving ? t('Saving…') : t('Save')}</button>
    </div>
  </div>
}
