# Day 2 — Design Corrections (CTO Audit)

**Date:** March 4, 2026
**Author:** CTO (Claude)
**Purpose:** Specific, actionable corrections based on auditing every component against the design spec in `tasks/day-02-design.md`. Hand this to the developer alongside the design brief.

---

## Three Systemic Problems (Fix These First)

These patterns repeat across every single file. Fix them globally before doing per-component work.

### Problem 1: Inline `style={{}}` Everywhere

Almost every component uses `style={{ color: 'var(--text-primary)' }}` or `style={{ backgroundColor: 'var(--surface-3)' }}`. The Tailwind config (`tailwind.config.ts`) already has all these tokens mapped. Use Tailwind classes instead.

**Rule:** If a CSS variable exists in both `globals.css` AND `tailwind.config.ts`, use the Tailwind class.

Quick reference:
```
style={{ color: 'var(--text-primary)' }}     → className="text-text-primary"
style={{ color: 'var(--text-secondary)' }}   → className="text-text-secondary"
style={{ color: 'var(--text-muted)' }}       → className="text-text-muted"
style={{ backgroundColor: 'white' }}         → className="bg-white"
style={{ backgroundColor: 'var(--surface)' }} → className="bg-surface"
style={{ backgroundColor: 'var(--surface-2)' }} → className="bg-surface-2"
style={{ backgroundColor: 'var(--surface-3)' }} → className="bg-surface-3"
style={{ borderColor: 'var(--border)' }}     → className="border-border"
style={{ borderColor: 'var(--border-subtle)' }} → className="border-border-subtle"
style={{ backgroundColor: '#1B1A18' }}       → className="bg-text-primary" (same hex)
style={{ color: '#F9F8F6' }}                 → className="text-background" (same hex)
style={{ backgroundColor: 'var(--blueberry-50)' }} → className="bg-blueberry-50"
style={{ color: 'var(--blueberry-600)' }}    → className="text-blueberry-600"
style={{ color: 'var(--matcha-600)' }}       → className="text-matcha-600"
```

For values NOT in Tailwind config, use arbitrary values: `text-[var(--blueberry-800)]` or add the token to `tailwind.config.ts`.

**Exception:** Dynamic/conditional styles that depend on JS variables (like `isUser ? '#1B1A18' : 'transparent'`) should use conditional classNames. Consider adding a `cn()` utility using `clsx`:

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}
```

Install: `pnpm add clsx`

### Problem 2: Inline Event Handlers for Hover/Focus States

This pattern appears in almost every interactive element:

```tsx
// BAD — current pattern
onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '...' }}
onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '...' }}
onFocus={(e) => { e.currentTarget.style.borderColor = '...' }}
onBlur={(e) => { e.currentTarget.style.borderColor = '...' }}
```

Replace with Tailwind pseudo-classes:

```tsx
// GOOD — Tailwind hover/focus
className="hover:bg-surface focus:border-blueberry-600 focus:ring-[3px] focus:ring-blueberry-600/[0.06]"
```

For the focus ring pattern used on all inputs/textareas, create a shared Tailwind class in `globals.css`:

```css
/* Add to globals.css */
.input-focus {
  @apply focus:border-blueberry-600 focus:ring-[3px] focus:ring-blueberry-600/[0.06] focus:outline-none;
}
```

Then every input just gets `className="... input-focus"` instead of 6 lines of onFocus/onBlur handlers.

For `focus-within` on containers (like the ChatInput wrapper):

```tsx
className="... focus-within:border-blueberry-600 focus-within:shadow-[0_0_0_3px_rgba(56,89,249,0.06)]"
```

### Problem 3: Hardcoded Pixel Values in `style={{}}`

Many elements use `style={{ fontSize: '11px' }}` or `style={{ width: '48px' }}`. Use Tailwind sizing:

```
fontSize: '11px'  → className="text-[11px]"
fontSize: '13px'  → className="text-[13px]"  (but see corrections below — most should be text-sm)
fontSize: '10px'  → className="text-[10px]"
width: '48px'     → className="w-12"
height: '48px'    → className="h-12"
width: '28px'     → className="w-7"
height: '28px'    → className="h-7"
width: '32px'     → className="w-8"
height: '32px'    → className="h-8"
width: '40px'     → className="w-10"
height: '40px'    → className="h-10"
padding: '24px'   → className="p-6"
padding: '48px'   → className="p-12"
gap: '12px'       → className="gap-3"
gap: '16px'       → className="gap-4"
```

---

## Per-Component Corrections

### 1. ChatInput.tsx

**Line 55 — outer container:**
```tsx
// CURRENT
style={{ borderColor: 'var(--border)', backgroundColor: 'white' }}
// FIX
className="border-t px-8 py-5 border-border bg-white"
// (remove the style prop entirely)
```

**Lines 59-62 — input wrapper:**
```tsx
// CURRENT
style={{ backgroundColor: 'var(--surface-3)', borderColor: 'var(--border)' }}
// FIX: add to className, remove style
className="... bg-surface-3 border-border focus-within:border-blueberry-600 focus-within:shadow-[0_0_0_3px_rgba(56,89,249,0.06)]"
```

**Lines 63-70 — DELETE the onFocusCapture/onBlurCapture handlers entirely.** The `focus-within:` above replaces them.

**Lines 81-86 — textarea inline styles:**
```tsx
// CURRENT
style={{ color: 'var(--text-primary)', caretColor: 'var(--blueberry-600)', minHeight: '28px', maxHeight: '200px' }}
// FIX
className="... text-text-primary caret-blueberry-600 min-h-[28px] max-h-[200px]"
```

**Lines 93-99 — send button:** Replace inline styles with conditional classNames:
```tsx
className={cn(
  "flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold transition-all duration-150",
  canSubmit
    ? "bg-text-primary text-background cursor-pointer hover:scale-105"
    : "bg-surface-2 text-text-muted cursor-not-allowed"
)}
```

**Lines 100-105 — DELETE the onMouseEnter/onMouseLeave handlers.** The `hover:scale-105` class above handles it.

**Line 120 — hint text:** Replace inline with `className="text-text-muted text-[11px] opacity-50"`.

### 2. MessageBubble.tsx

**Lines 20-22 — workflow intro text:**
```tsx
// CURRENT
style={{ color: 'var(--text-secondary)', maxWidth: '672px' }}
// FIX
className="text-sm leading-relaxed text-text-secondary max-w-2xl"
```

**Lines 39-47 — message bubble:** This is the most impactful change. Replace the entire inline style block with conditional classes:
```tsx
<div
  className={cn(
    "text-sm leading-relaxed max-w-2xl whitespace-pre-wrap break-words",
    isUser
      ? "bg-text-primary text-background rounded-[20px_20px_6px_20px] px-5 py-3.5"
      : "text-text-primary px-1 py-2"
  )}
>
```
This eliminates the entire `style={{}}` block.

### 3. MessageList.tsx (Empty State) — **HIGHEST PRIORITY VISUAL FIX**

**Line 70 — wordmark container:** Replace inline with className:
```tsx
// CURRENT
style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
// FIX
className="text-center flex flex-col gap-3"
```

**Lines 73-78 — wordmark "Yalc":**
```tsx
// CURRENT
style={{ color: 'var(--text-primary)', letterSpacing: '-0.04em', fontSize: '60px', lineHeight: 1 }}
// FIX
className="font-bold text-text-primary tracking-[-0.04em] text-[60px] leading-none"
```

**Lines 83-88 — TAGLINE IS 11px. THIS IS THE BIGGEST VISUAL BUG.**
```tsx
// CURRENT — too small, makes the app feel like a prototype
style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic', letterSpacing: '0.02em' }}
// FIX — bump to 16px per spec
className="text-text-muted text-base italic tracking-wide"
```

**Lines 94-99 — description text:**
```tsx
// CURRENT
style={{ color: 'var(--text-secondary)', maxWidth: '380px', margin: '4px auto 0', fontSize: '14px' }}
// FIX
className="leading-relaxed text-text-secondary max-w-[380px] mx-auto mt-1 text-sm"
```

**Lines 107-113 — action cards grid:**
```tsx
// CURRENT — entirely inline
style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', width: '100%', maxWidth: '760px' }}
// FIX
className="grid grid-cols-3 gap-4 w-full max-w-[760px]"
```

**Lines 119-123 — each action card:**
```tsx
// CURRENT
style={{ backgroundColor: 'var(--surface-3)', borderColor: 'var(--border)', padding: '24px' }}
// FIX
className="text-left rounded-2xl border transition-all duration-200 bg-surface-3 border-border p-6 hover:border-[var(--accent)] hover:bg-white hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:-translate-y-0.5"
```

**Lines 124-137 — DELETE all onMouseEnter/onMouseLeave handlers.** Replace with the hover classes above. Note: for the per-card accent color on hover, you'll need to use a CSS custom property approach:
```tsx
style={{ '--accent': card.accent } as React.CSSProperties}
className="... hover:border-[var(--accent)]"
```
This keeps only ONE tiny style prop (the accent variable) instead of 8 lines of event handlers.

**Lines 145-149 — icon container:**
```tsx
// CURRENT
style={{ width: '48px', height: '48px', backgroundColor: card.iconBg, color: card.iconColor }}
// FIX — keep style only for dynamic card colors
className="flex items-center justify-center rounded-xl mb-4 w-12 h-12"
style={{ backgroundColor: card.iconBg, color: card.iconColor }}
```

**Lines 155-156, 160-163 — card title/description:**
```tsx
// title CURRENT
style={{ color: 'var(--text-primary)' }}
// FIX: add text-text-primary to className, remove style

// description CURRENT
style={{ color: 'var(--text-muted)' }}
// FIX: add text-text-muted to className, remove style
```

**Lines 170-173 — bottom hint:**
```tsx
// CURRENT
style={{ color: 'var(--text-muted)', opacity: 0.4 }}
// FIX
className="text-xs text-text-muted opacity-40"
```

### 4. WorkflowPreviewCard.tsx

**Lines 42-47 — container:**
```tsx
// CURRENT
style={{ backgroundColor: 'white', borderColor: 'var(--border)', maxWidth: '672px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
// FIX
className="rounded-2xl border overflow-hidden mt-3 animate-slide-up bg-white border-border max-w-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
```

**Line 52 — header border:**
```tsx
// CURRENT
style={{ borderColor: 'var(--border-subtle)' }}
// FIX
className="px-6 pt-6 pb-4 border-b border-border-subtle"
```

**Lines 57-58 — title:**
```tsx
// CURRENT
style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}
// FIX
className="text-base font-bold leading-tight text-text-primary tracking-[-0.01em]"
```

**Lines 63-64 — description:**
```tsx
// CURRENT
style={{ color: 'var(--text-secondary)' }}
// FIX: className="text-sm mt-1.5 leading-relaxed text-text-secondary"
```

**Lines 71-77 — time badge:**
```tsx
// CURRENT
style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '11px', padding: '5px 12px' }}
// FIX
className="flex-shrink-0 font-bold rounded-lg bg-surface-2 text-text-muted whitespace-nowrap text-[11px] px-3 py-[5px]"
```

**Lines 93-98 — API key badges:**
```tsx
// CURRENT
style={{ backgroundColor: 'var(--blueberry-50)', color: 'var(--blueberry-800)', fontSize: '11px', padding: '3px 10px', letterSpacing: '0.03em' }}
// FIX
className="font-bold rounded-lg bg-blueberry-50 text-[var(--blueberry-800)] text-[11px] px-2.5 py-[3px] tracking-wide"
```

**Lines 117-121 — step row border:** Replace inline border with conditional class:
```tsx
className={cn(
  "flex items-start gap-3.5 px-6 py-4",
  index < workflow.steps.length - 1 && "border-b border-border-subtle"
)}
```

**Lines 125-132 — step number circle:**
```tsx
// CURRENT
style={{ width: '28px', height: '28px', backgroundColor: typeStyle.bg, color: typeStyle.color, fontSize: '12px', marginTop: '1px' }}
// FIX
className="flex-shrink-0 flex items-center justify-center rounded-lg font-bold w-7 h-7 text-xs mt-px"
style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}
```

**Lines 197 — action bar:**
```tsx
// CURRENT
style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
// FIX
className="px-6 py-4 flex items-center gap-3 border-t border-border bg-surface"
```

**Lines 203-213 — approve button:** Replace inline styles + event handlers with conditional classes:
```tsx
className={cn(
  "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all duration-150",
  isRunning
    ? "bg-text-muted text-background cursor-not-allowed opacity-50"
    : "bg-text-primary text-background cursor-pointer hover:bg-text-secondary"
)}
// DELETE onMouseEnter/onMouseLeave handlers
```

### 5. Sidebar.tsx

**Lines 76-80 — aside container:** Keep `style` only for the dynamic width (depends on `collapsed`):
```tsx
className="flex flex-col h-full border-r transition-all duration-200 bg-white border-border"
style={{ width: collapsed ? '60px' : '228px', minWidth: collapsed ? '60px' : '228px' }}
```

**Line 82 — header div:**
```tsx
// CURRENT
style={{ borderColor: 'var(--border)', padding: '16px 16px 16px 16px' }}
// FIX
className="flex items-center gap-3 border-b border-border p-4"
```

**Line 85 — logo box:**
```tsx
// CURRENT
style={{ width: '32px', height: '32px', backgroundColor: '#1B1A18', color: '#F9F8F6', fontSize: '13px' }}
// FIX
className="flex-shrink-0 flex items-center justify-center font-bold rounded-xl w-8 h-8 bg-text-primary text-background text-[13px]"
```

**Line 91 — "YALC" text:**
```tsx
// CURRENT
style={{ color: 'var(--text-primary)', letterSpacing: '0.15em', fontSize: '11px' }}
// FIX
className="font-bold uppercase text-text-primary tracking-[0.15em] text-[11px]"
```

**Line 92 — "Day 2 of 30":**
```tsx
// CURRENT
style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px' }}
// FIX
className="text-text-muted text-[10px] mt-0.5"
```

**Line 104 — nav items:** Replace inline styles with conditional classes. But more importantly:

**Line 125 — NAV LABELS AT 13px. SHOULD BE 14px (text-sm).**
```tsx
// CURRENT
style={{ fontSize: '13px' }}
// FIX — remove the style prop, add text-sm to className
className="flex-1 truncate text-sm"
```

**Lines 111-112 — DELETE onMouseEnter/onMouseLeave on nav items.** Replace with:
```tsx
className={cn(
  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
  isActive ? "" : item.comingSoon ? "" : "hover:bg-surface"
)}
```

**Line 115 — active indicator bar:**
```tsx
// CURRENT
style={{ position: 'absolute', left: 0, top: '6px', bottom: '6px', width: '3px', borderRadius: '99px', backgroundColor: item.accentColor }}
// FIX
className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
style={{ backgroundColor: item.accentColor }}
```

**Line 127 — SOON badge:**
```tsx
// CURRENT
style={{ backgroundColor: 'var(--oat-200)', color: 'var(--text-muted)', fontSize: '9px', padding: '2px 8px', letterSpacing: '0.04em' }}
// FIX
className="font-bold rounded-md bg-oat-200 text-text-muted text-[9px] px-2 py-0.5 tracking-wide"
```

**Lines 141-142 — collapse button hover:** DELETE onMouseEnter/onMouseLeave:
```tsx
className="w-full flex items-center justify-center px-3 py-2 rounded-xl text-xs transition-colors duration-150 text-text-muted hover:bg-surface"
```

### 6. OnboardingModal.tsx

**Lines 27-28 — backdrop:**
```tsx
// CURRENT
style={{ backgroundColor: 'rgba(27, 26, 24, 0.5)', backdropFilter: 'blur(12px)' }}
// FIX
className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[12px]"
```

**Lines 33-37 — modal card:**
```tsx
// CURRENT
style={{ backgroundColor: 'white', padding: '48px', maxHeight: '90vh', overflowY: 'auto' }}
// FIX
className="w-full max-w-2xl rounded-3xl shadow-2xl modal-enter bg-white p-12 max-h-[90vh] overflow-y-auto"
```

### 7. WelcomeStep.tsx

**Line 17:**
```tsx
// CURRENT
style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
// FIX
className="text-2xl font-bold mb-2 text-text-primary tracking-[-0.02em]"
```

**Line 22:**
```tsx
// CURRENT
style={{ color: 'var(--text-secondary)', maxWidth: '420px' }}
// FIX
className="text-sm leading-relaxed mb-8 text-text-secondary max-w-[420px]"
```

**Lines 41-45, 47-53 — input fields:** Replace inline styles + focus/blur handlers:
```tsx
className="w-full rounded-xl border px-4 py-3.5 text-sm outline-none transition-all duration-200 border-border bg-surface-3 text-text-primary input-focus"
// DELETE onFocus and onBlur handlers entirely
```

Same fix for the LinkedIn input (lines 76-84).

**Lines 94-98 — continue button:** Use conditional classes:
```tsx
className={cn(
  "w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-150",
  canContinue
    ? "bg-text-primary text-background cursor-pointer"
    : "bg-surface-2 text-text-muted cursor-not-allowed"
)}
// DELETE the style prop entirely
```

### 8. UploadStep.tsx

**Lines 32-33 — continue button:**
```tsx
// CURRENT
style={{ backgroundColor: '#1B1A18', color: '#F9F8F6', cursor: 'pointer' }}
// FIX
className="flex-1 py-3.5 rounded-xl text-sm font-bold transition-all duration-150 bg-text-primary text-background cursor-pointer"
```

**Lines 38-39 — skip button:**
```tsx
// CURRENT
style={{ backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}
// FIX
className="py-3.5 px-6 rounded-xl text-sm transition-all duration-150 bg-transparent text-text-secondary border border-border cursor-pointer"
```

### 9. FileDropZone.tsx

**Lines 67-72 — drop zone:** Keep only the dynamic `isDragOver` styles minimal:
```tsx
className={cn(
  "rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 p-12 text-center",
  isDragOver
    ? "border-blueberry-600 bg-blueberry-600/[0.04]"
    : "border-border-subtle bg-surface"
)}
// DELETE the style prop
```

**Line 74 — icon container:**
```tsx
// CURRENT
style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.8 }}
// FIX
className="text-4xl mb-3 opacity-80"
```

**Lines 91, 93 — file card:**
```tsx
// CURRENT
style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
// FIX
className="flex items-center justify-between rounded-xl px-4 py-3 bg-surface border border-border"
```

**Lines 100-101 — remove button:** DELETE onMouseEnter/onMouseLeave:
```tsx
className="text-xs px-2.5 py-1 rounded-lg transition-colors duration-150 text-pomegranate-600 hover:bg-pomegranate-600/[0.08]"
```

### 10. ProcessingStep.tsx

**Lines 96-100 — status message:**
```tsx
// Keep style only for animationDelay (dynamic per index)
className={cn(
  "flex items-center gap-3 text-sm fade-in-up",
  status.done ? "text-matcha-600" : "text-text-primary"
)}
style={{ animationDelay: `${i * 0.15}s`, animationFillMode: 'backwards' }}
```

**Line 103 — checkmark:**
```tsx
// CURRENT
style={{ fontSize: '16px', lineHeight: 1 }}
// FIX
className="text-base leading-none"
```

### 11. FrameworkEditor.tsx

**Line 14 — Section component:**
```tsx
// CURRENT
style={{ backgroundColor: open ? 'var(--surface)' : 'transparent', border: '1px solid var(--border)' }}
// FIX
className={cn("rounded-xl overflow-hidden border border-border", open ? "bg-surface" : "bg-transparent")}
```

**Lines 49-55 — Field input:**
```tsx
// CURRENT
style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--text-primary)', ... }}
// FIX
className="w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors duration-150 border-border bg-background text-text-primary input-focus"
// DELETE onFocus/onBlur handlers
```

Same fix for TagField input (lines 104-107).

### 12. QuestionsStep.tsx

**Line 139 — progress bar track:**
```tsx
// CURRENT
style={{ width: '100%', height: '2px', backgroundColor: 'var(--border)', borderRadius: '99px' }}
// FIX
className="mb-8 w-full h-0.5 bg-border rounded-full"
```

**Lines 141-147 — progress bar fill:**
```tsx
// CURRENT (style for everything)
// FIX — keep style only for the dynamic width
className="h-full bg-blueberry-600 rounded-full transition-[width] duration-300"
style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
```

**Lines 163-178, 206-222 — input focus/blur handlers:** Same fix as above — use `input-focus` class, DELETE onFocus/onBlur.

**Lines 188-192 — select option buttons:**
```tsx
// CURRENT
style={{ borderColor: answer === opt ? '...' : '...', backgroundColor: answer === opt ? '...' : '...' }}
// FIX
className={cn(
  "w-full text-left px-5 py-4 rounded-xl border text-sm transition-all duration-150 text-text-primary",
  answer === opt
    ? "border-blueberry-600 bg-blueberry-50"
    : "border-border bg-surface-3"
)}
```

**Lines 229-234 — next button:** Same conditional class pattern as other CTA buttons.

### 13. StepIndicator.tsx

This component is already fairly clean. The only inline styles are for dynamic width/colors which is appropriate since they depend on the `i === currentStep` condition. **No changes needed** — this one is fine.

---

## Summary Checklist

- [ ] Install `clsx` (`pnpm add clsx`) and create `src/lib/utils.ts` with `cn()` helper
- [ ] Add `.input-focus` utility class to `globals.css`
- [ ] **Fix tagline from 11px to text-base (16px)** in `MessageList.tsx` line 85
- [ ] **Fix nav labels from 13px to text-sm (14px)** in `Sidebar.tsx` line 125
- [ ] Migrate all `style={{}}` color/bg/border props to Tailwind classes (every file)
- [ ] Replace all `onMouseEnter/onMouseLeave` hover patterns with Tailwind `hover:` classes
- [ ] Replace all `onFocus/onBlur` border patterns with `input-focus` class or Tailwind `focus:` classes
- [ ] Replace `onFocusCapture/onBlurCapture` in ChatInput with `focus-within:` on the container
- [ ] Verify build passes: `pnpm build`
- [ ] Take after-screenshots

**Priority order:** Systemic Problem 1 + 2 + 3 → MessageList tagline → Sidebar nav labels → Everything else.
