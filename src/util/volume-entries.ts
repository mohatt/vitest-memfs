import path from 'node:path'
import isGlob from 'is-glob'
import { toRegex } from 'glob-to-regex.js'
import { isPlainObject } from './common.js'
import type { VolumePathType, VolumePathEntry } from './volume.js'

export type VolumeEntryType = Exclude<VolumePathType, 'other'> | 'any'

export interface VolumeEntryRecord {
  type?: VolumeEntryType
  count?: number
}

export interface VolumeEntryArrayRecord extends VolumeEntryRecord {
  path: string
}

export type VolumeEntries =
  | string
  | Array<string | VolumeEntryArrayRecord>
  | Record<string, VolumeEntryType | VolumeEntryRecord>

export type MatchRules = Map<string, MatchRule>

export function createMatchRules(input: VolumeEntries, prefix?: string): MatchRules {
  const basePrefix = resolvePrefix(prefix)
  const rules: MatchRules = new Map()

  function addRule(path: string, opts?: VolumeEntryRecord) {
    const entry = createMatchRule(path, basePrefix, opts)
    rules.set(entry.identifier, entry)
  }

  if (typeof input === 'string') {
    addRule(input)
  } else if (Array.isArray(input)) {
    for (const value of input) {
      if (typeof value === 'string') {
        addRule(value)
      } else if (isPlainObject(value) && typeof value.path === 'string') {
        addRule(value.path, value)
      } else {
        throw new TypeError(
          `Expected array item to be string | { path: string }, got \`${JSON.stringify(value)}\``,
        )
      }
    }
  } else if (isPlainObject(input)) {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        addRule(key, { type: value })
      } else if (isPlainObject(value)) {
        addRule(key, value)
      } else {
        throw new TypeError(
          `Expected object value for key \`${key}\` to be string | plain object, got \`${JSON.stringify(value)}\``,
        )
      }
    }
  } else {
    throw new TypeError(`Expected string | array | plain object, got \`${JSON.stringify(input)}\``)
  }

  return rules
}

interface ExactMatchRule {
  kind: 'exact'
  identifier: string
  path: string
  expType: VolumeEntryType
}

interface GlobMatchRule {
  kind: 'glob'
  identifier: string
  pattern: string
  regex: RegExp
  expType: VolumeEntryType
  expCount: number
}

type MatchRule = ExactMatchRule | GlobMatchRule

function createMatchRule(rawPath: string, prefix: string, config?: VolumeEntryRecord): MatchRule {
  const { type, count } = config ?? {}
  if (type != null && !VALID_ENTRY_TYPES.includes(type)) {
    throw new TypeError(
      `Expected entry type to be \`${VALID_ENTRY_TYPES.join('`, `')}\`, got \`${type}\``,
    )
  }

  if (count != null && count <= 0) {
    throw new TypeError(`Expected entry count to be a positive integer, got \`${count}\``)
  }

  const resolved = rawPath.startsWith('/')
    ? path.posix.normalize(rawPath)
    : path.posix.join(prefix, rawPath)
  const expType = type ?? 'any'

  if (isGlobLike(rawPath)) {
    return {
      kind: 'glob',
      identifier: `glob(\`${resolved}\`)`,
      pattern: resolved,
      regex: toRegex(resolved),
      expType,
      expCount: count ?? 1,
    }
  }

  return {
    kind: 'exact',
    identifier: resolved,
    path: resolved,
    expType,
  }
}

interface DiffEntry {
  exists?: boolean
  type?: string
  count?: number
}

export function matchEntries(pathEntries: VolumePathEntry[], rules: MatchRules) {
  const actualDiff: Record<string, DiffEntry> = {}
  const expectedDiff: Record<string, DiffEntry> = {}
  const allMatches: VolumePathEntry[] = []
  let missingCount = 0
  let typeCount = 0

  rules.forEach((rule) => {
    if (rule.kind === 'exact') {
      const match = pathEntries.find(([path]) => path === rule.path)
      if (!match) {
        actualDiff[rule.identifier] = { exists: false }
        expectedDiff[rule.identifier] = { exists: true }
        missingCount++
        return
      }

      if (rule.expType !== 'any' && match[1] !== rule.expType) {
        actualDiff[rule.identifier] = { type: match[1] }
        expectedDiff[rule.identifier] = { type: rule.expType }
        typeCount++
        return
      }

      allMatches.push(match)
      return
    }

    const matches = pathEntries.filter(([path]) => rule.regex.test(path))
    if (matches.length < rule.expCount) {
      actualDiff[rule.identifier] = { count: matches.length }
      expectedDiff[rule.identifier] = { count: rule.expCount }
      missingCount++
      return
    }

    if (rule.expType !== 'any') {
      const typeMatches = matches.filter(([, type]) => type === rule.expType)
      if (typeMatches.length < rule.expCount) {
        actualDiff[rule.identifier] = { count: typeMatches.length }
        expectedDiff[rule.identifier] = { count: rule.expCount }
        typeCount++
        return
      }

      allMatches.push(...typeMatches)
      return
    }

    allMatches.push(...matches)
  })

  return {
    missingCount,
    typeCount,
    diff: { actual: actualDiff, expected: expectedDiff },
    matches: allMatches,
  }
}

function resolvePrefix(prefix?: string) {
  if (!prefix) return '/'
  const resolved = path.posix.resolve('/', prefix)
  return resolved === '/' ? '/' : resolved.replace(/\/$/, '')
}

export function isGlobLike(value: string) {
  return isGlob(value, { strict: false })
}

export function parseRegExp(value: string) {
  const match = /^\/(.{1,4096})\/([gimsuy]{0,6})$/.exec(value)
  if (match) {
    const [, expr, flags] = match
    return new RegExp(expr, flags)
  }
  return null
}

const VALID_ENTRY_TYPES: readonly VolumeEntryType[] = ['file', 'dir', 'symlink', 'any']
