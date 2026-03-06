'use client'

interface StepIndicatorProps {
  currentStep: number
  totalSteps: number
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-10">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-300"
          style={{
            width: i === currentStep ? '32px' : '8px',
            height: '8px',
            backgroundColor:
              i < currentStep
                ? 'var(--matcha-600)'
                : i === currentStep
                ? 'var(--blueberry-600)'
                : 'var(--border)',
          }}
        />
      ))}
    </div>
  )
}
