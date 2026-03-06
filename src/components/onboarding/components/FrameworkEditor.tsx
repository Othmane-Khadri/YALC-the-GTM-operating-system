'use client'

import { useState } from 'react'
import type { GTMFramework } from '@/lib/framework/types'
import { cn } from '@/lib/utils'

interface FrameworkEditorProps {
  framework: Partial<GTMFramework>
  onChange: (updated: Partial<GTMFramework>) => void
}

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn("rounded-xl overflow-hidden border border-border", open ? "bg-surface" : "bg-transparent")}>
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors duration-150"
        onClick={() => setOpen(!open)}
      >
        <span className="text-base font-bold text-text-primary">{title}</span>
        <span className="text-xs text-text-muted transition-transform duration-200">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="px-5 py-5 space-y-4 bg-white">
          {children}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, multiline = false }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean
}) {
  const Component = multiline ? 'textarea' : 'input'
  return (
    <div>
      <label className="block text-xs font-bold uppercase mb-1.5 text-text-muted tracking-[0.06em]">
        {label}
      </label>
      <Component
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors duration-150 border-border bg-background text-text-primary input-focus"
        style={{
          minHeight: multiline ? '80px' : undefined,
          resize: multiline ? 'vertical' : undefined,
        }}
      />
    </div>
  )
}

function TagField({ label, values, onChange }: {
  label: string; values: string[]; onChange: (v: string[]) => void
}) {
  const [input, setInput] = useState('')
  return (
    <div>
      <label className="block text-xs font-bold uppercase mb-1.5 text-text-muted tracking-[0.06em]">
        {label}
      </label>
      <div className="flex flex-wrap gap-2 mb-2">
        {values.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-bold bg-blueberry-50 text-[var(--blueberry-800)]"
          >
            {tag}
            <button
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="hover:opacity-70 transition-opacity text-[11px]"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) {
            e.preventDefault()
            onChange([...values, input.trim()])
            setInput('')
          }
        }}
        placeholder="Type and press Enter"
        className="w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors duration-150 border-border bg-background text-text-primary input-focus"
      />
    </div>
  )
}

export function FrameworkEditor({ framework, onChange }: FrameworkEditorProps) {
  const company = framework.company || {} as GTMFramework['company']
  const positioning = framework.positioning || {} as GTMFramework['positioning']
  const segments = framework.segments || []
  const competitors = positioning.competitors || []

  const updateCompany = (field: string, value: string) => {
    onChange({ ...framework, company: { ...company, [field]: value } as GTMFramework['company'] })
  }

  const updatePositioning = (field: string, value: unknown) => {
    onChange({ ...framework, positioning: { ...positioning, [field]: value } as GTMFramework['positioning'] })
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      <Section title="Company Overview" defaultOpen={true}>
        <Field label="Company Name" value={company.name || ''} onChange={(v) => updateCompany('name', v)} />
        <Field label="Industry" value={company.industry || ''} onChange={(v) => updateCompany('industry', v)} />
        <Field label="Description" value={company.description || ''} onChange={(v) => updateCompany('description', v)} multiline />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stage" value={company.stage || ''} onChange={(v) => updateCompany('stage', v)} />
          <Field label="Team Size" value={company.teamSize || ''} onChange={(v) => updateCompany('teamSize', v)} />
        </div>
      </Section>

      <Section title="Positioning" defaultOpen={true}>
        <Field label="Value Proposition" value={positioning.valueProp || ''} onChange={(v) => updatePositioning('valueProp', v)} multiline />
        <Field label="Category" value={positioning.category || ''} onChange={(v) => updatePositioning('category', v)} />
        <TagField label="Differentiators" values={positioning.differentiators || []} onChange={(v) => updatePositioning('differentiators', v)} />
        <TagField label="Proof Points" values={positioning.proofPoints || []} onChange={(v) => updatePositioning('proofPoints', v)} />
      </Section>

      {segments.map((seg, i) => (
        <Section key={seg.id || i} title={`ICP Segment: ${seg.name || `Segment ${i + 1}`}`}>
          <Field
            label="Segment Name"
            value={seg.name || ''}
            onChange={(v) => {
              const updated = [...segments]
              updated[i] = { ...updated[i], name: v }
              onChange({ ...framework, segments: updated })
            }}
          />
          <Field
            label="Description"
            value={seg.description || ''}
            onChange={(v) => {
              const updated = [...segments]
              updated[i] = { ...updated[i], description: v }
              onChange({ ...framework, segments: updated })
            }}
            multiline
          />
          <TagField
            label="Target Roles"
            values={seg.targetRoles || []}
            onChange={(v) => {
              const updated = [...segments]
              updated[i] = { ...updated[i], targetRoles: v }
              onChange({ ...framework, segments: updated })
            }}
          />
          <TagField
            label="Pain Points"
            values={seg.painPoints || []}
            onChange={(v) => {
              const updated = [...segments]
              updated[i] = { ...updated[i], painPoints: v }
              onChange({ ...framework, segments: updated })
            }}
          />
        </Section>
      ))}

      {competitors.length > 0 && (
        <Section title="Competitors">
          {competitors.map((comp, i) => (
            <div key={i} className="rounded-xl p-4 mb-3 bg-surface border border-border">
              <Field
                label="Name"
                value={comp.name || ''}
                onChange={(v) => {
                  const updated = [...competitors]
                  updated[i] = { ...updated[i], name: v }
                  updatePositioning('competitors', updated)
                }}
              />
              <div className="mt-3">
                <Field
                  label="Positioning"
                  value={comp.positioning || ''}
                  onChange={(v) => {
                    const updated = [...competitors]
                    updated[i] = { ...updated[i], positioning: v }
                    updatePositioning('competitors', updated)
                  }}
                />
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}
