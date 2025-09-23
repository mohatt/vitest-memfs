import { vi, expect } from 'vitest'

export async function importActualFS() {
  return vi.importActual<typeof import('fs/promises')>('fs/promises')
}

type MatchersObject = Parameters<(typeof expect)['extend']>[0]

/**
 * Creates and returns a matcher function.
 * We could wrap the matcher function in the future to warn on un-awaited promises.
 */
export function createMatcher<T extends keyof MatchersObject>(matcher: T, fn: MatchersObject[T]) {
  Object.defineProperty(fn, 'name', { value: matcher })
  return fn
}
