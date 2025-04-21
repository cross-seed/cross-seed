import { useState } from 'react'
import { Button } from '@/components/ui/button'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <header className="w-full max-w-4xl mb-8">
        <h1 className="text-3xl font-bold text-center text-foreground">
          Cross-Seed
        </h1>
        <p className="text-center mt-2 text-muted-foreground">
          Fully-automatic cross-seeding with Torznab
        </p>
      </header>

      <main className="w-full max-w-4xl rounded-lg shadow-md p-6 bg-card text-card-foreground">
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-4">
            Welcome to Cross-Seed Web UI
          </h2>
          <p className="text-muted-foreground">
            This is the web interface for the Cross-Seed application.
            Coming soon: monitor activity, manage configuration, and trigger searches.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center p-6 rounded-lg bg-muted">
          <Button
            onClick={() => setCount((count) => count + 1)}
            variant="default"
          >
            Count is: {count}
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            This demo button uses the shadcn/ui Button component.
          </p>
        </div>
      </main>

      <footer className="w-full max-w-4xl mt-8 text-center text-sm text-muted-foreground">
        <p>Cross-Seed Web UI - Open Source</p>
      </footer>
    </div>
  )
}

export default App