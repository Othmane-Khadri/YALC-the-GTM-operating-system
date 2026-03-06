import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { CampaignsView } from '@/components/campaigns/CampaignsView'

export default function CampaignsPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen">
        <Sidebar activeItem="campaigns" />
        <main className="flex-1 overflow-hidden">
          <CampaignsView />
        </main>
      </div>
    </JotaiProvider>
  )
}
