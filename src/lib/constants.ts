// ─── External URLs ─────────────────────────────────────────────────────────
// Centralized so affiliate/UTM links and signup URLs are easy to update.
// These are the SIGNUP links (account creation). API key dashboard links
// are separate and live in the provider config arrays.

export const SIGNUP_URLS = {
  unipile: 'https://www.unipile.com/?utm_source=partner&utm_campaign=Yalc',
  fullenrich: 'https://fullenrich.com?via=sNO0yIysrHzw',
  instantly: 'https://instantly.ai?via=yalc',
  orthogonal: 'https://www.orthogonal.com/?utm_source=yalc&utm_medium=referral&utm_campaign=in-app',
} as const

/** @deprecated Use SIGNUP_URLS.instantly */
export const INSTANTLY_SIGNUP_URL = SIGNUP_URLS.instantly
