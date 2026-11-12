// @vitest-environment happy-dom
// DAYON - Treino: Settings → Account → Delete account (components/DayonAccount.jsx). The store's
// deleteAccount is a stand-in here; store/useDayon.test.js and lib/dayon-cloud-delete.test.js
// test what it does.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ toast: vi.fn(), sheets: [] }))
vi.mock('../lib/dayon-cloud.js', () => ({ meusVinculos: vi.fn(async () => ({ comoAluno: [], comoPersonal: [] })), nomeDe: vi.fn(async () => null) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: () => {} }))
vi.mock('../lib/nav.js', () => ({ nav: () => {} }))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => h.toast(...a), openSheet: render => { h.sheets.push(render); return {} } })
  const useUI = sel => (sel ? sel(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})

const { useDayon } = await import('../store/useDayon.js')
const { DayonSignedIn, DeleteAccountSheet } = await import('./DayonAccount.jsx')

let host, root
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)) })
const render = async el => { act(() => root.render(el)); await flush() }
const click = async el => { act(() => el.click()); await flush() }
const byText = (txt, sel = 'button, .lrow') => [...host.querySelectorAll(sel)].find(e => e.textContent.includes(txt))
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const submit = async () => { act(() => host.querySelector('form').requestSubmit()); await flush() }
const deleteAccount = vi.fn(async () => {})

beforeEach(() => {
  h.sheets = []
  h.toast.mockClear()
  deleteAccount.mockReset().mockResolvedValue()
  useDayon.setState({ user: { uid: 'a1', email: 'a@d.c' }, perfil: { nome: 'Bia', papel: 'aluno' }, status: 'ok', deleteAccount })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useDayon.setState({ user: null, perfil: null, status: 'off' })
})

describe('Delete account', () => {
  it('the signed-in account shows "Delete account", which opens the confirmation', async () => {
    const close = vi.fn()
    await render(<DayonSignedIn close={close} />)
    await click(byText('Delete account'))
    expect(h.sheets).toHaveLength(1)
    const sheetClose = vi.fn()
    await render(h.sheets[0](sheetClose))
    expect(host.textContent).toContain('Delete your Dayon account?')
    expect(host.textContent).toContain('This can’t be undone.')
  })

  it('says what goes, asks the password, and deletes only on the last button', async () => {
    const close = vi.fn(), onDeleted = vi.fn()
    await render(<DeleteAccountSheet close={close} onDeleted={onDeleted} />)
    for (const s of ['Your Dayon account and profile', 'Your plan, workouts and settings saved in the cloud',
      'Your links with trainers or students, and the student codes you made', 'its data is cleared too']) expect(host.textContent).toContain(s)
    const final = byText('Delete everything forever')
    expect(final.disabled).toBe(true)
    type(host.querySelector('input[type=password]'), 'secret1')
    await flush()
    expect(final.disabled).toBe(false)
    await click(final)
    expect(deleteAccount).toHaveBeenCalledWith('secret1')
    expect(close).toHaveBeenCalled()
    expect(onDeleted).toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('Account deleted')
  })

  it('a wrong password: says so, stays open, and can be tried again', async () => {
    const close = vi.fn()
    deleteAccount.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/wrong-password' }))
    await render(<DeleteAccountSheet close={close} />)
    type(host.querySelector('input[type=password]'), 'nope')
    await submit()
    expect(host.querySelector('[role=alert]').textContent).toBe('Wrong password. Try again.')
    expect(close).not.toHaveBeenCalled()
    expect(byText('Delete everything forever').disabled).toBe(false)
  })

  it('too many tries and no connection read in plain words', async () => {
    await render(<DeleteAccountSheet close={vi.fn()} />)
    type(host.querySelector('input[type=password]'), 'x')
    deleteAccount.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/too-many-requests' }))
    await submit()
    expect(host.querySelector('[role=alert]').textContent).toBe('Too many tries. Wait a moment and try again.')
    deleteAccount.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }))
    await submit()
    expect(host.querySelector('[role=alert]').textContent).toBe('No connection. Check the internet and try again.')
  })

  it('Cancel closes without deleting', async () => {
    const close = vi.fn()
    await render(<DeleteAccountSheet close={close} />)
    await click(byText('Cancel'))
    expect(close).toHaveBeenCalled()
    expect(deleteAccount).not.toHaveBeenCalled()
  })
})
