'use client'

import { useAtom } from 'jotai'
import { onboardingDataAtom, onboardingStepAtom } from '@/atoms/onboarding'
import { FileDropZone } from '../components/FileDropZone'

export function UploadStep() {
  const [data, setData] = useAtom(onboardingDataAtom)
  const [, setStep] = useAtom(onboardingStepAtom)

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2 text-text-primary tracking-[-0.02em]">
        Drop any docs that describe your business.
      </h2>
      <p className="text-sm leading-relaxed mb-8 text-text-secondary">
        ICP documents, pitch decks, competitor analyses, positioning docs — anything that helps us understand your GTM.
      </p>

      <FileDropZone
        files={data.uploadedFiles}
        onFilesChange={(files) => setData({ ...data, uploadedFiles: files })}
      />

      <div className="flex gap-3 mt-10">
        <button
          onClick={() => setStep(2)}
          className="flex-1 py-3.5 rounded-xl text-sm font-bold transition-all duration-150 bg-text-primary text-background cursor-pointer"
        >
          Continue
        </button>
        <button
          onClick={() => setStep(2)}
          className="py-3.5 px-6 rounded-xl text-sm transition-all duration-150 bg-transparent text-text-secondary border border-border cursor-pointer"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
