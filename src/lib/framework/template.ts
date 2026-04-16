import type { GTMFramework } from './types'

export function createEmptyFramework(): GTMFramework {
  return {
    company: {
      name: '',
      website: '',
      linkedinUrl: '',
      industry: '',
      subIndustry: '',
      stage: 'seed',
      description: '',
      teamSize: '',
      foundedYear: 0,
      headquarters: '',
    },
    positioning: {
      valueProp: '',
      tagline: '',
      category: '',
      differentiators: [],
      proofPoints: [],
      competitors: [],
    },
    segments: [],
    channels: {
      active: [],
      preferences: {},
    },
    signals: {
      buyingIntentSignals: [],
      monitoringKeywords: [],
      triggerEvents: [],
    },
    objections: [],
    learnings: [],
    connectedProviders: [],
    onboardingComplete: false,
    lastUpdated: new Date().toISOString(),
    version: 1,
  }
}
