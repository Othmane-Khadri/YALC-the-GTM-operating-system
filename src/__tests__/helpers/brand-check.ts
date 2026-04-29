/**
 * Brand-fidelity helpers for the visualize skill suite.
 *
 * Approach (Option A from the 0.9.G brief): static parse the HTML — regex
 * + hex extraction + class-string scan. We keep node_modules clean (no
 * Playwright) and accept hex-equality instead of ΔE because the visualize
 * skill body emits exact hex codes per the brand-token contract. If a
 * future revision wants computed-style rendering, swap to Option B
 * (Playwright); the assertion contracts here remain the same.
 */

const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g

/** Extract every hex color literal from the HTML. Returns canonical 6-digit upper-case. */
export function extractHexColors(html: string): Set<string> {
  const out = new Set<string>()
  let match: RegExpExecArray | null
  HEX_RE.lastIndex = 0
  while ((match = HEX_RE.exec(html)) !== null) {
    out.add(canonicaliseHex(match[1]))
  }
  return out
}

/** Normalize 3-digit hex to 6-digit upper-case. 8-digit (alpha) → drop alpha. */
export function canonicaliseHex(raw: string): string {
  let h = raw.toUpperCase()
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length === 8) h = h.slice(0, 6)
  return `#${h}`
}

/** Forbidden Tailwind color utility prefixes — all blue/gray/slate variants. */
export const FORBIDDEN_TAILWIND_CLASSES = [
  'bg-blue-',
  'text-blue-',
  'border-blue-',
  'ring-blue-',
  'bg-gray-',
  'text-gray-',
  'border-gray-',
  'ring-gray-',
  'bg-slate-',
  'text-slate-',
  'border-slate-',
  'ring-slate-',
  'bg-zinc-',
  'text-zinc-',
  'bg-neutral-',
  'text-neutral-',
  'bg-stone-',
  'text-stone-',
] as const

/**
 * Walk every `class="..."` / `className="..."` string in the HTML and
 * return any forbidden Tailwind tokens it contains.
 */
export function findForbiddenTailwindClasses(html: string): string[] {
  const out: string[] = []
  const classRe = /\bclass(?:Name)?=["']([^"']+)["']/g
  let match: RegExpExecArray | null
  while ((match = classRe.exec(html)) !== null) {
    const tokens = match[1].split(/\s+/)
    for (const tok of tokens) {
      for (const forbidden of FORBIDDEN_TAILWIND_CLASSES) {
        if (tok.startsWith(forbidden)) {
          out.push(tok)
        }
      }
    }
  }
  return out
}

/** Returns true when `family` appears as a font-family declaration in any <style> block. */
export function hasFontFamily(html: string, family: string): boolean {
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi
  const fam = family.toLowerCase()
  let block
  while ((block = styleRe.exec(html)) !== null) {
    if (block[1].toLowerCase().includes(fam)) return true
  }
  // Also accept inline style attributes as a fallback.
  return html.toLowerCase().includes(fam)
}

/** Returns true when `url` appears in a `<link rel="stylesheet" href="...">` tag. */
export function hasFontStylesheet(html: string, url: string): boolean {
  const lower = html.toLowerCase()
  return lower.includes(url.toLowerCase())
}

/** Asserts the brand primary hex appears at least once and forbidden defaults do not. */
export interface BrandCheck {
  primaryHex: string
  accentHex: string
  fontHeading: string
  fontBody: string
  webfontUrl: string
}

export function assertBrandFidelity(html: string, brand: BrandCheck): {
  ok: boolean
  errors: string[]
} {
  const errors: string[] = []
  const hexes = extractHexColors(html)
  if (!hexes.has(canonicaliseHex(brand.primaryHex.replace(/^#/, '')))) {
    errors.push(`Primary brand color ${brand.primaryHex} not found in HTML.`)
  }
  if (!hexes.has(canonicaliseHex(brand.accentHex.replace(/^#/, '')))) {
    errors.push(`Accent brand color ${brand.accentHex} not found in HTML.`)
  }
  if (!hasFontFamily(html, brand.fontHeading)) {
    errors.push(`Heading font "${brand.fontHeading}" not declared in any <style> block.`)
  }
  if (!hasFontFamily(html, brand.fontBody)) {
    errors.push(`Body font "${brand.fontBody}" not declared in any <style> block.`)
  }
  if (!hasFontStylesheet(html, brand.webfontUrl)) {
    errors.push(`Webfont URL "${brand.webfontUrl}" not linked in <head>.`)
  }
  const forbidden = findForbiddenTailwindClasses(html)
  if (forbidden.length > 0) {
    errors.push(`Forbidden Tailwind classes detected: ${forbidden.join(', ')}.`)
  }
  return { ok: errors.length === 0, errors }
}
