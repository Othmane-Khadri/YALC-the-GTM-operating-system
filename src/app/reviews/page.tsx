import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { ReviewsView } from '@/components/reviews/ReviewsView'

export default function ReviewsPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen">
        <Sidebar activeItem="reviews" />
        <main className="flex-1 overflow-hidden">
          <ReviewsView />
        </main>
      </div>
    </JotaiProvider>
  )
}
