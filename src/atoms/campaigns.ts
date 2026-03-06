import { atom } from 'jotai'
import type { Campaign, CampaignStatus } from '@/lib/campaign/types'

export const campaignsAtom = atom<Campaign[]>([])
export const activeCampaignAtom = atom<Campaign | null>(null)
export const campaignsLoadingAtom = atom(false)
export const campaignFilterAtom = atom<CampaignStatus | 'all'>('all')
