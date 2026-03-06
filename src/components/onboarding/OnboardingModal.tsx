'use client'

import { useAtomValue } from 'jotai'
import { onboardingOpenAtom, onboardingStepAtom } from '@/atoms/onboarding'
import { StepIndicator } from './components/StepIndicator'
import { WelcomeStep } from './steps/WelcomeStep'
import { UploadStep } from './steps/UploadStep'
import { ProcessingStep } from './steps/ProcessingStep'
import { ReviewStep } from './steps/ReviewStep'
import { QuestionsStep } from './steps/QuestionsStep'

const STEPS = [WelcomeStep, UploadStep, ProcessingStep, ReviewStep, QuestionsStep]
const TOTAL_STEPS = STEPS.length

export function OnboardingModal() {
  const isOpen = useAtomValue(onboardingOpenAtom)
  const currentStep = useAtomValue(onboardingStepAtom)

  if (!isOpen) return null

  const StepComponent = STEPS[currentStep] || WelcomeStep

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[12px]">
      <div className="w-full max-w-2xl rounded-3xl shadow-2xl modal-enter bg-white p-12 max-h-[90vh] overflow-y-auto">
        <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />
        <StepComponent />
      </div>
    </div>
  )
}
