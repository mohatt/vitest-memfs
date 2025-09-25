import { vi, expect } from 'vitest'

/**
 * Imports the real `fs/promises` module, bypassing Vitest mocks.
 *
 * A direct import works in most cases, but if `fs` is mocked
 * in a Vitest setup file it will return the mock instead.
 */
export async function importActualFS() {
  return vi.importActual<typeof import('fs/promises')>('fs/promises')
}

export function isPlainObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
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
