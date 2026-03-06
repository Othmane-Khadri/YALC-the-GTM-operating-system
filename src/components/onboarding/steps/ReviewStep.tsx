'use client'

import { useAtom } from 'jotai'
import { onboardingDataAtom, onboardingStepAtom } from '@/atoms/onboarding'
import { FrameworkEditor } from '../components/FrameworkEditor'
import type { GTMFramework } from '@/lib/framework/types'

export function ReviewStep() {
  const [data, setData] = useAtom(onboardingDataAtom)
  const [, setStep] = useAtom(onboardingStepAtom)

  const framework = data.extractedFramework || ({} as Partial<GTMFramework>)

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2 text-text-primary tracking-[-0.02em]">
        Here&apos;s what we found.
      </h2>
      <p className="text-sm leading-relaxed mb-6 text-text-secondary">
        Edit anything that&apos;s off. You can always update this later.
      </p>

      <FrameworkEditor
        framework={framework}
        onChange={(updated) => setData({ ...data, extractedFramework: updated })}
      />

      <div className="mt-8">
        <button
          onClick={() => setStep(4)}
          className="w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-150 bg-text-primary text-background cursor-pointer"
        >
          Looks good — Continue
        </button>
      </div>
    </div>
  )
}
