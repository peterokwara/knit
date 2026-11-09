import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        // Import the database only inside the server handler.
        const { openDatabase } = await import('../server/db/connection')
        const database = openDatabase()
        try {
          database.prepare('SELECT 1').get()
          return Response.json({ status: 'ok' })
        } finally {
          database.close()
        }
      },
    },
  },
})
