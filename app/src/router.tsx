import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * Create the router used to render the application's routes.
 * @returns A router configured with the generated route tree.
 */
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true })
}
