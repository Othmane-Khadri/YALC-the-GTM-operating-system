/**
 * GateDiffModal — lightweight modal wrapper around `GateDiffView` (D3).
 *
 * Lives outside Today.tsx so the page-level edit surface stays small
 * (D4 + C5 are touching the same file in parallel — minimising the
 * diff there reduces merge conflict surface). We deliberately don't
 * pull in `@/components/ui/dialog` (radix-dialog) because Today is
 * the only consumer and importing it inflates the bundle past budget.
 */

import type { ReactElement } from 'react'
import { GateDiffView } from './GateDiffView'
import { tryParseJson } from '@/lib/render'

export interface GateDiffModalItem {
  framework: string
  run_id: string
  gate_id: string
  payload: unknown
}

interface GateDiffModalProps {
  item: GateDiffModalItem
  /** Current JSON-string draft from the textarea — diffed against `item.payload`. */
  draft: string
  onClose: () => void
}

export function GateDiffModal({ item, draft, onClose }: GateDiffModalProps): ReactElement {
  const parsed = tryParseJson(draft)
  const finalValue = parsed.ok ? parsed.value : item.payload
  return (
    <div
      data-testid={`today-diff-modal-${item.framework}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-w-3xl w-full max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="font-heading text-lg font-bold">Pending edits — {item.gate_id}</h2>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <GateDiffView original={item.payload} final={finalValue} />
      </div>
    </div>
  )
}
