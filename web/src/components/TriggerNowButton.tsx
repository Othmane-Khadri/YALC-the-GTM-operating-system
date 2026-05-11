/**
 * Trigger-now button for /today on-demand framework cards (D4).
 *
 * Lives in its own file so the SPA test surface is independent of /today's
 * larger feed component (which D3 + C5 are also editing). Returns null for
 * scheduled frameworks so callers can render the button unconditionally.
 */

import { Button } from '@/components/ui/button'

export function TriggerNowButton(props: {
  framework: string
  mode: 'on-demand' | 'scheduled' | undefined
  busy: boolean
  onClick: () => void
}): JSX.Element | null {
  if (props.mode !== 'on-demand') return null
  return (
    <Button
      size="sm"
      variant="outline"
      data-testid={`today-trigger-${props.framework}`}
      disabled={props.busy}
      onClick={props.onClick}
    >
      {props.busy ? 'Triggering…' : 'Trigger now'}
    </Button>
  )
}
