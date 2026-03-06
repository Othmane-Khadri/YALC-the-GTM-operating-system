import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { CampaignDetail } from '@/components/campaigns/CampaignDetail'

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <JotaiProvider>
      <div className="flex h-screen">
        <Sidebar activeItem="campaigns" />
        <main className="flex-1 overflow-hidden">
          <CampaignDetail campaignId={id} />
        </main>
      </div>
    </JotaiProvider>
  )
}
