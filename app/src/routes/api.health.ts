import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        // Import the database only inside the server handler.
        const { SqliteHelper } = await import('../server/utils/sqliteHelper')
        const database = SqliteHelper.openConnection()
        try {
          SqliteHelper.queryOne(database, 'SELECT 1')
          return Response.json({ status: 'ok' })
        } finally {
          SqliteHelper.closeConnection(database)
        }
      },
    },
  },
})
