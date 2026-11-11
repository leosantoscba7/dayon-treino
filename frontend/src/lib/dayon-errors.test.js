import { describe, expect, it } from 'vitest'
import { dayonMessage, isOffline } from './dayon-errors.js'

describe('dayonMessage', () => {
  it('says each Firebase Auth failure in plain words', () => {
    expect(dayonMessage({ code: 'auth/email-already-in-use' })).toMatch(/already has a Dayon account/)
    expect(dayonMessage({ code: 'auth/weak-password' })).toMatch(/6 characters/)
    expect(dayonMessage({ code: 'auth/invalid-credential' })).toMatch(/wrong/)
    expect(dayonMessage({ code: 'auth/invalid-email' })).toMatch(/doesn’t look right/)
    expect(dayonMessage({ code: 'auth/too-many-requests' })).toMatch(/Too many tries/)
  })
  it('a missing config and no network have their own message; anything else a generic one', () => {
    expect(dayonMessage({ code: 'dayon/unconfigured' })).toMatch(/isn’t set up/)
    expect(dayonMessage({ code: 'auth/network-request-failed' })).toMatch(/No connection/)
    expect(dayonMessage(new Error('x'))).toMatch(/Something went wrong/)
    expect(dayonMessage(null)).toMatch(/Something went wrong/)
  })
  it('isOffline', () => {
    expect(isOffline({ code: 'unavailable' })).toBe(true)
    expect(isOffline({ code: 'dayon/timeout' })).toBe(true)
    expect(isOffline({ code: 'permission-denied' })).toBe(false)
  })
})
