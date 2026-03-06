'use client'

import { useAtom } from 'jotai'
import { onboardingDataAtom, onboardingStepAtom } from '@/atoms/onboarding'
import { cn } from '@/lib/utils'

export function WelcomeStep() {
  const [data, setData] = useAtom(onboardingDataAtom)
  const [, setStep] = useAtom(onboardingStepAtom)

  const canContinue = data.websiteUrl.trim().length > 0

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2 text-text-primary tracking-[-0.02em]">
        Let&apos;s set up your GTM operating system.
      </h2>
      <p className="text-sm leading-relaxed mb-8 text-text-secondary max-w-[420px]">
        We&apos;ll analyze your company and build a personalized context that makes every workflow smarter.
      </p>

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-bold uppercase mb-2 text-text-secondary tracking-[0.06em]">
            Company website *
          </label>
          <input
            type="url"
            value={data.websiteUrl}
            onChange={(e) => setData({ ...data, websiteUrl: e.target.value })}
            placeholder="https://yourcompany.com"
            className="w-full rounded-xl border px-4 py-3.5 text-sm outline-none transition-all duration-200 border-border bg-surface-3 text-text-primary input-focus"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase mb-2 text-text-secondary tracking-[0.06em]">
            Your LinkedIn profile
            <span className="font-normal normal-case ml-1.5 text-text-muted tracking-normal">(optional)</span>
          </label>
          <input
            type="url"
            value={data.linkedinUrl}
            onChange={(e) => setData({ ...data, linkedinUrl: e.target.value })}
            placeholder="https://linkedin.com/in/yourname"
            className="w-full rounded-xl border px-4 py-3.5 text-sm outline-none transition-all duration-200 border-border bg-surface-3 text-text-primary input-focus"
          />
        </div>
      </div>

      <div className="mt-10">
        <button
          onClick={() => setStep(1)}
          disabled={!canContinue}
          className={cn(
            "w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-150",
            canContinue
              ? "bg-text-primary text-background cursor-pointer"
              : "bg-surface-2 text-text-muted cursor-not-allowed"
          )}
        >
          Continue
        </button>
      </div>
    </div>
  )
}
