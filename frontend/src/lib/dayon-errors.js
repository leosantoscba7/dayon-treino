// DAYON - Treino: what to tell someone when Dayon sign-in or sync fails, in plain words.
// Firebase errors carry a `code` ('auth/email-already-in-use', 'unavailable', ...); the app's own
// carry 'dayon/...' (lib/dayon-cloud.js).
import { t } from './i18n-core.js'

const OFFLINE = new Set(['auth/network-request-failed', 'unavailable', 'deadline-exceeded', 'dayon/timeout', 'dayon/offline'])

/** Whether `e` means "no connection": the change stays here and goes later. */
export const isOffline = e => OFFLINE.has(e?.code)

export function dayonMessage(e) {
  switch (e?.code) {
    case 'auth/email-already-in-use': return t('This email already has a Dayon account. Sign in instead.')
    case 'auth/weak-password': return t('The password needs at least 6 characters.')
    case 'auth/invalid-email': return t('That email address doesn’t look right.')
    case 'auth/missing-password':
    case 'dayon/missing-fields': return t('Enter your email and password.')
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials': return t('Email or password is wrong.')
    case 'auth/user-disabled': return t('This account was turned off. Talk to Dayon.')
    case 'auth/too-many-requests': return t('Too many tries. Wait a moment and try again.')
    case 'dayon/unconfigured': return t('Dayon sign-in isn’t set up in this version yet. You can keep using the app on this device.')
    case 'dayon/invalid-code': return t('This code isn’t valid or was already used.')
    case 'dayon/already-trainer': return t('You are already a trainer on Dayon.')
    case 'dayon/own-code': return t('This code is yours. Send it to your student.')
    case 'dayon/too-big': return t('Part of your data is too big for the Dayon cloud. It stays on this device.')
    case 'permission-denied': return t('Dayon refused this change. Sign in again and try once more.')
    default:
      if (isOffline(e)) return t('No connection. Check the internet and try again.')
      return t('Something went wrong. Try again.')
  }
}
