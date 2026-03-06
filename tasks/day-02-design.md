# Day 2 — Visual Design Overhaul (All Components)

**Date:** March 4, 2026
**Author:** CTO (Claude)
**Context:** The framework architecture and onboarding flow are built. Everything works functionally. Now make it feel premium. The current state looks like a prototype — it needs to feel like a product you'd pay for.

---

## Files to Read First

1. `docs/BRAND.md` — the design system. Every decision must trace back to this.
2. `src/app/globals.css` — current color variables and animations
3. `tailwind.config.ts` — current design tokens
4. Every component you'll be modifying (listed below)

## Design Reference

**Step 0: Take "before" screenshots**
- Run `pnpm dev`, open http://localhost:3000
- Screenshot the empty chat state → `docs/screenshots/day-02-before-chat.png`
- Screenshot the onboarding modal (delete the framework from DB first or temporarily force it open) → `docs/screenshots/day-02-before-onboarding.png`

**Step 1: Study Clay's design language**
- Use web browsing to visit and inspect https://clay.com
- Extract:
  - Typography scale and hierarchy (how big are headlines vs body vs labels?)
  - Spacing rhythm (their padding and margin values)
  - Whitespace philosophy (how much breathing room between elements?)
  - Card treatment (borders, shadows, radius, padding)
  - Button styling (size, padding, weight, hover states)
  - Input field styling (height, padding, border, focus states)
  - Transition timings
  - How they create visual "weight" without heaviness

---

## Global Fixes (apply first, everything benefits)

### `src/app/globals.css`

Add these foundational improvements:

```css
/* Selection highlight */
::selection {
  background: var(--blueberry-50);
  color: var(--text-primary);
}

/* Smooth scrolling globally */
html {
  scroll-behavior: smooth;
}

/* Better text rendering for monospace */
body {
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.01em;
}
```

### Typography Scale

Establish a clear hierarchy. The current problem is everything is `text-xs`. Define these levels and USE THEM consistently:

| Level | Tailwind | Size | Use for |
|-------|----------|------|---------|
| Display | `text-4xl` or `text-5xl` | 36-48px | Empty state wordmark only |
| Heading | `text-xl` or `text-2xl` | 20-24px | Modal titles, section headers |
| Subheading | `text-base` | 16px | Card titles, step titles |
| Body | `text-sm` | 14px | Message text, descriptions, input text |
| Caption | `text-xs` | 12px | Labels, metadata, timestamps, hints |

**Rule: Message body text is ALWAYS `text-sm` (14px). Never `text-xs` for readable content.**

### Spacing Rhythm

Use a consistent 4px grid. The current components use random padding values. Standardize:

| Token | Value | Use for |
|-------|-------|---------|
| Tight | `p-2` / `gap-2` | Inside small badges, between icon + label |
| Default | `p-4` / `gap-4` | Inside cards, between form fields |
| Comfortable | `p-6` / `gap-6` | Section padding, between major sections |
| Spacious | `p-8` / `gap-8` | Modal padding, hero sections |
| Generous | `p-10` or `p-12` | Page-level padding, empty state centering |

### Inline Styles → Tailwind

Migrate inline `style={{}}` objects to Tailwind classes wherever possible. The current codebase mixes both, which creates visual inconsistency. Use Tailwind's arbitrary value syntax `[#hex]` when needed:
- `style={{ color: 'var(--text-primary)' }}` → `text-text-primary`
- `style={{ background: 'var(--surface)' }}` → `bg-surface`
- For CSS variables not in Tailwind config, use `text-[var(--blueberry-600)]` or add to tailwind.config.ts

---

## Component-by-Component Design Spec

### 1. ChatInput.tsx

**Current problems:** Text too small, feels cramped, send button is tiny, char counter is noisy.

**Target state:**
- Textarea text: `text-sm` (14px) — readable, not squinting
- Textarea padding: `px-5 py-4` — spacious
- Container: rounded-2xl border, generous internal padding
- Min height: ~52px (single line), max height: 200px
- Border: `border-border` default, `border-blueberry-600` on focus with `ring-2 ring-blueberry-50`
- Background: white (`#FFFFFF`) or `surface-3` — slightly lifted from the oat background
- Send button: 40x40px minimum, rounded-xl, transition scale on hover (`hover:scale-105`)
- Remove the char counter entirely — it adds noise
- Placeholder: `text-text-muted text-sm`, something like "Describe your GTM goal..."
- Bottom hint: keep it but make it more subtle — `text-[11px] text-text-muted opacity-60`
- Add a subtle shadow to the entire input container: `shadow-sm`

### 2. MessageBubble.tsx

**Current problems:** Messages too narrow, text too small, assistant border + shadow is noisy, no line height.

**Target state:**
- Message text: `text-sm leading-relaxed` (14px, line-height 1.625) — monospace NEEDS this
- Max width: `max-w-2xl` (672px) instead of `max-w-xl` (576px)
- **User messages:**
  - Background: `#1B1A18` (keep the dark style)
  - Text: `#F9F8F6`
  - Padding: `px-5 py-3.5`
  - Border radius: `rounded-2xl rounded-br-md` (rounded everywhere except bottom-right — the "tail")
  - No border, no shadow
- **Assistant messages:**
  - Background: transparent or very subtle `bg-surface/50`
  - Text: `text-text-primary`
  - NO border, NO shadow — just the text with breathing room
  - Padding: `px-1 py-2` — assistant messages feel more like flowing text, not boxed
  - This creates a clear asymmetry: user = contained bubble, assistant = open text
- Message entrance animation: keep `message-enter` but slow it to 300ms and use `ease-out`

### 3. MessageList.tsx (Empty State)

**Current problems:** Wordmark could be bolder, action cards are cramped, tagline doesn't pop.

**Target state:**
- Center the empty state vertically AND horizontally in the viewport
- **Wordmark "Yalc":** `text-6xl font-bold tracking-tight` (60px) — make it a statement
- **Tagline:** `text-base text-text-secondary italic mt-3` — not tiny, it's the hook
- **Description text:** `text-sm text-text-muted mt-2 max-w-md mx-auto`
- **Action cards grid:** `gap-4 mt-10` — more breathing room
  - Each card: `p-6 rounded-2xl` — generous padding
  - Icon container: `w-12 h-12 rounded-xl` — bigger, more visual weight
  - Card title: `text-sm font-bold mt-3`
  - Card description: `text-xs text-text-muted mt-1 leading-relaxed`
  - Hover: subtle scale (`hover:scale-[1.02]`) + shadow-md + border color transition
  - Transition: `transition-all duration-200`
- **Bottom hint:** "or type anything below" — `text-xs text-text-muted mt-8 opacity-50`

### 4. WorkflowPreviewCard.tsx

**Current problems:** Dense, text small, cramped internally, "Run this workflow" button doesn't feel like a confident CTA.

**Target state:**
- Container: `rounded-2xl` (not just xl), `p-0` (padding handled per section), max-w-2xl
- **Header section:** `px-6 pt-6 pb-4` — breathe
  - Title: `text-base font-bold` (16px, not 13px)
  - Description: `text-sm text-text-secondary mt-1 leading-relaxed`
  - Time badge: keep small (`text-[11px]`), but more padding `px-3 py-1`
- **API key badges:** `text-[11px] px-2.5 py-1 rounded-lg font-bold` — slight size up
- **Steps section:**
  - Each step: `px-6 py-4` — more vertical breathing room
  - Step number: `w-7 h-7` (28px, up from 22px), `text-xs font-bold`
  - Step title: `text-sm font-bold`
  - Type pill: `text-[10px]` — keep small, it's a label
  - Provider pill: `text-[10px]` — keep small
  - Description: `text-sm text-text-secondary leading-relaxed`
  - Row count: `text-xs text-text-muted`
- **Action bar:** `px-6 py-4`
  - "Run this workflow" button: `px-6 py-3 text-sm font-bold rounded-xl` — bigger, more confident
  - Hover: `hover:bg-text-secondary` (slightly lighter black) + `transition-colors duration-150`
  - "Edit steps" button: `px-4 py-3 text-sm rounded-xl border`

### 5. Sidebar.tsx

**Current problems:** Unicode icons look amateurish, overall too compact, "SOON" badges are hard to read.

**Target state:**
- Keep the collapsible behavior
- **Logo area:** `px-4 py-5` — slightly more vertical space
  - "Y" box: `w-8 h-8` (32px, up from 28px), `rounded-xl`
  - "YALC" text: `text-xs font-bold tracking-[0.15em]` — wider letter spacing
  - "Day 2 of 30": keep subtle
- **Nav items:**
  - Each item: `px-3 py-2.5 rounded-xl` (up from rounded-lg)
  - Icon bubble: `w-7 h-7` (28px, up from 24px)
  - Item text: `text-sm` (14px, up from 13px)
  - Active item: keep the left indicator bar but make it `rounded-full` and `w-[3px]`
  - "SOON" badge: `text-[9px] px-2 py-0.5 rounded-md` — keep subtle but readable
- **Consider:** Replace Unicode icons (⬡, ◎, ◈, ◆, ⬟, ◇) with simple SVG icons or emoji that read better at small sizes. The Unicode geometric shapes render inconsistently across platforms.

### 6. OnboardingModal.tsx

**Target state:**
- Backdrop: `bg-black/40 backdrop-blur-sm` — slightly more dramatic
- Modal card: `max-w-2xl w-full rounded-3xl shadow-2xl` — premium shadow, rounder corners
- Internal padding: `p-10` — generous
- Step transitions: CSS `transition-opacity duration-300` between steps (fade, not instant swap)

### 7. WelcomeStep.tsx

**Target state:**
- Title: `text-2xl font-bold` — big, confident
- Subtitle: `text-sm text-text-secondary mt-2 leading-relaxed max-w-md`
- Input fields:
  - Label: `text-xs font-bold text-text-secondary uppercase tracking-wide mb-2`
  - Input: `text-sm px-4 py-3.5 rounded-xl border-border focus:border-blueberry-600 focus:ring-2 focus:ring-blueberry-50`
  - Background: white or `surface-3`
  - Height: ~48px (generous touch target)
- Gap between fields: `gap-5`
- Continue button: `w-full py-3.5 text-sm font-bold rounded-xl bg-[#1B1A18] text-[#F9F8F6]`
- Bottom padding for the button: `mt-8`

### 8. UploadStep.tsx

**Target state:**
- Title: `text-2xl font-bold`
- FileDropZone:
  - `rounded-2xl border-2 border-dashed border-border-subtle p-10`
  - On drag: `border-blueberry-600 bg-blueberry-50/30` — clear visual feedback
  - Icon: larger, centered, `text-3xl`
  - Text: `text-sm text-text-secondary mt-3`
  - Accepted formats hint: `text-xs text-text-muted mt-1`
- File list: each file card with `rounded-xl bg-surface p-3`, subtle remove button
- Buttons: same style as WelcomeStep — full-width primary, ghost secondary

### 9. ProcessingStep.tsx

**Target state:**
- Title: `text-2xl font-bold`
- Status messages:
  - Each message fades in with `animation: fadeIn 0.4s ease-out`
  - Active: `text-sm text-text-primary font-medium` with a gentle pulse or spinner
  - Completed: `text-sm text-matcha-600` with a checkmark `✓`
  - Pending: `text-sm text-text-muted`
  - Stagger: 200ms delay between each message appearance
- Overall feel: calm, confident progress. Not anxious.
- Add a subtle animated element — maybe a pulsing dot or slow spinner next to the current step

### 10. ReviewStep.tsx / FrameworkEditor.tsx

**Target state:**
- Title: `text-2xl font-bold`
- Subtitle: `text-sm text-text-secondary`
- Scrollable area: `max-h-[60vh] overflow-y-auto` with subtle scrollbar
- **Section headers:** `text-base font-bold` with chevron toggle `▸` / `▾`
- **Section cards:** `rounded-xl bg-surface p-5` when expanded
- **Form fields:**
  - Label: `text-xs font-bold text-text-muted uppercase tracking-wide mb-1.5`
  - Input: `text-sm px-3.5 py-2.5 rounded-lg border-border`
  - Textarea: same but `min-h-[80px]`
- **Tag inputs:** rounded pills with `bg-blueberry-50 text-blueberry-800 text-xs px-2.5 py-1 rounded-full`, "×" remove button
- **Segment cards:** bordered cards within the ICP section, each with a colored left bar (use segment priority color)
- "Looks good" button: full-width primary CTA

### 11. QuestionsStep.tsx

**Target state:**
- Title: `text-2xl font-bold` + question progress `text-sm text-text-muted`
- **Conversational feel** — each question should feel like the AI is asking, not like a form
- Question text: `text-base text-text-primary leading-relaxed` — readable, not tiny
- Input area: same generous styling as WelcomeStep inputs
- **Select options:** displayed as `rounded-xl border p-4` cards, not flat buttons. Active: `border-blueberry-600 bg-blueberry-50`. Hover: `border-border-subtle bg-surface`
- "Next question" button: primary style, right-aligned
- "Skip remaining" link: `text-xs text-text-muted underline` — subtle, not a button

### 12. StepIndicator.tsx

**Target state:**
- Dots: `w-2 h-2` default, current step elongates to `w-8 h-2`
- Colors: `bg-border` (pending), `bg-blueberry-600` (current), `bg-matcha-600` (complete)
- `rounded-full` on all states
- Transition: `transition-all duration-300`
- Gap: `gap-2`
- Centered with `mx-auto mb-8`

---

## After All Changes

**Step 3: Take "after" screenshots**
- `docs/screenshots/day-02-after-chat.png`
- `docs/screenshots/day-02-after-onboarding.png`

**Build check:** `pnpm build` — fix all TypeScript errors

**Commit:** `feat: premium visual overhaul — all components (Day 2)`

**Report:** Append visual changes to `tasks/day-02-report.md`:
- List every component modified
- Key design decisions (with rationale)
- Note any Tailwind config changes
- Confirm before/after screenshots saved
