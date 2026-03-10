'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-8">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-bold text-text-primary mb-2">Something went wrong</h2>
        <p className="text-sm text-text-muted mb-1">
          {error.message || 'An unexpected error occurred.'}
        </p>
        {error.digest && (
          <p className="text-xs text-text-muted opacity-50 mb-4">
            Error ID: {error.digest}
          </p>
        )}
      </div>
      <button
        onClick={reset}
        className="px-5 py-2.5 rounded-xl text-sm font-bold bg-text-primary text-background hover:bg-text-secondary transition-all duration-150"
      >
        Try again
      </button>
    </div>
  )
}
