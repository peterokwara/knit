import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main>
      <h1>School fees</h1>
      <p>The bursar screen will show family invoices and payment explanations here.</p>
    </main>
  )
}
