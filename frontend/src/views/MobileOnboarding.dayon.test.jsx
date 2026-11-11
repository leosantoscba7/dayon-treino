// @vitest-environment happy-dom
// DAYON - Treino: the first-launch screen offers the optional Dayon account beside the two
// choices it always had; "Use on this device" stays exactly what it was.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useDayon } from '../store/useDayon.js'
import { _setLangState } from '../lib/i18n-core.js'
import MobileOnboarding from './MobileOnboarding.jsx'
import { DayonAccountSheet } from '../components/DayonAccount.jsx'

let root, host
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  _setLangState('en', null, null, null)
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useDayon.setState({ available: false, user: null }) })

describe('MobileOnboarding with Dayon', () => {
  it('keeps Use on this device and Connect to my server, and adds Sign in to Dayon', () => {
    const chooseLocalMode = vi.fn()
    useStore.setState({ chooseLocalMode })
    act(() => root.render(<MobileOnboarding />))
    const labels = [...host.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(labels.slice(0, 3)).toEqual(['Use on this device', 'Sign in to Dayon', 'Connect to my server'])
    act(() => button('Use on this device').click())
    expect(chooseLocalMode).toHaveBeenCalledTimes(1)
    expect(useUI.getState().sheets).toHaveLength(0)
  })
  it('Sign in to Dayon opens the sheet and leaves the local choice alone', () => {
    const chooseLocalMode = vi.fn()
    useStore.setState({ chooseLocalMode })
    act(() => root.render(<MobileOnboarding />))
    act(() => button('Sign in to Dayon').click())
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(chooseLocalMode).not.toHaveBeenCalled()
  })
})

describe('DayonAccountSheet', () => {
  it('without a Firebase config: says so, no form, no crash', () => {
    useDayon.setState({ available: false, user: null })
    act(() => root.render(<DayonAccountSheet close={() => {}} />))
    expect(host.textContent).toMatch(/isn’t set up in this version yet/)
    expect(host.querySelector('input[type="password"]')).toBeNull()
  })
  it('with a config: email and password, sign in or create an account', () => {
    useDayon.setState({ available: true, user: null })
    act(() => root.render(<DayonAccountSheet close={() => {}} />))
    expect(host.querySelector('input[type="email"]')).not.toBeNull()
    expect(host.querySelector('input[type="password"]')).not.toBeNull()
    act(() => button('Create account').click())
    expect(host.querySelector('input[autocomplete="name"]')).not.toBeNull()
  })
  it('a failed sign-in is said in plain words under the fields', async () => {
    const signIn = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/invalid-credential' }))
    useDayon.setState({ available: true, user: null, signIn })
    act(() => root.render(<DayonAccountSheet close={() => {}} />))
    const type = (el, value) => act(() => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type(host.querySelector('input[type="email"]'), 'ana@exemplo.com')
    type(host.querySelector('input[type="password"]'), 'segredo1')
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(signIn).toHaveBeenCalledWith({ email: 'ana@exemplo.com', senha: 'segredo1' })
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Email or password is wrong.')
  })
  it('signed in: the account, how the sync stands, and signing out keeps the data', () => {
    useDayon.setState({ available: true, user: { uid: 'u1', email: 'ana@exemplo.com', nome: 'Ana' }, perfil: { nome: 'Ana', papel: 'aluno' }, status: 'offline', choice: false })
    act(() => root.render(<DayonAccountSheet close={() => {}} />))
    expect(host.textContent).toMatch(/Ana/)
    expect(host.textContent).toMatch(/Offline: changes stay on this device/)
    expect(host.textContent).toMatch(/Signing out keeps everything on this device/)
    expect(button('Sign out of Dayon')).toBeTruthy()
    expect(button('Sign out and clear this browser')).toBeFalsy()
  })
})
