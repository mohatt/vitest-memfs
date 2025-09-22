import { createHash } from 'node:crypto'
import { isText } from 'istextorbinary'
import type { VolumeMap, VolumeMapEntry } from './volume.js'

export type VolumeCompareListMatch = 'exact' | 'ignore-extra' | 'ignore-missing'
export type VolumeCompareReportType = 'first' | 'all'

export interface VolumeCompareOptions {
  listMatch?: VolumeCompareListMatch
  report?: VolumeCompareReportType
}

export interface VolumeCompareResult {
  pass: boolean
  message: () => string
  actual?: unknown
  expected?: unknown
}

/**
 * Compare two volume maps.
 *
 * @param received map from volume under test
 * @param expected map from reference (snapshot or other volume)
 * @param options extra options
 */
export function compareVolumeMaps(
  received: VolumeMap,
  expected: VolumeMap,
  options?: VolumeCompareOptions,
): VolumeCompareResult {
  if (options?.report === 'all') {
    return compareVolumeMapsFull(received, expected, options)
  }

  const listMatch = options?.listMatch
  // make sorted arrays for error reporting and better diffing
  const actualFiles = Object.keys(received).sort()
  const expectedFiles = Object.keys(expected).sort()

  let listMismatchResult: {
    reason: string
    actual: string[]
    expected: string[]
  } | null = null

  switch (listMatch) {
    case 'ignore-extra': {
      const missing = expectedFiles.filter((f) => !(f in received))
      if (missing.length > 0) {
        listMismatchResult = {
          reason: `volume is missing ${missing.length} expected file${missing.length > 1 ? 's' : ''}`,
          actual: actualFiles.filter((f) => f in expected),
          expected: expectedFiles,
        }
      }
      break
    }

    case 'ignore-missing': {
      const extra = actualFiles.filter((f) => !(f in expected))
      if (extra.length > 0) {
        listMismatchResult = {
          reason: `volume has ${extra.length} unexpected file${extra.length > 1 ? 's' : ''}`,
          actual: actualFiles,
          expected: expectedFiles.filter((f) => f in received),
        }
      }
      break
    }

    case 'exact':
    default: {
      if (
        actualFiles.length !== expectedFiles.length ||
        !actualFiles.every((f, i) => f === expectedFiles[i])
      ) {
        listMismatchResult = {
          reason: 'directory structure didn’t match',
          actual: actualFiles,
          expected: expectedFiles,
        }
      }
    }
  }

  if (listMismatchResult) {
    return {
      pass: false,
      message: () => listMismatchResult.reason,
      actual: listMismatchResult.actual,
      expected: listMismatchResult.expected,
    }
  }

  // compare contents
  const filesToCheck = listMatch === 'ignore-missing' ? actualFiles : expectedFiles
  for (const file of filesToCheck) {
    const exp = expected[file]
    const act = received[file]
    if (exp.type !== act.type) {
      return {
        pass: false,
        message: () => `path type mismatch at \`${file}\``,
        actual: makeEntryPreview(file, act),
        expected: makeEntryPreview(file, exp),
      }
    }
    if (exp.type === 'file') {
      const expBuff = exp.data
      const actBuff = (act as typeof exp).data
      if (!expBuff.equals(actBuff)) {
        return {
          pass: false,
          message: () => `mismatch in file \`${file}\``,
          actual: makeEntryPreview(file, act),
          expected: makeEntryPreview(file, exp),
        }
      }
    } else if (exp.type === 'symlink') {
      const expTarget = exp.target
      const actTarget = (act as typeof exp).target

      if (expTarget !== actTarget) {
        return {
          pass: false,
          message: () => `symlink target mismatch at \`${file}\``,
          actual: makeEntryPreview(file, act),
          expected: makeEntryPreview(file, exp),
        }
      }
    }
  }

  // everything is matched at this point
  return {
    pass: true,
    message: () => 'volumes matched',
  }
}

export function compareVolumeMapsFull(
  received: VolumeMap,
  expected: VolumeMap,
  options?: Omit<VolumeCompareOptions, 'report'>,
) {
  const listMatch = options?.listMatch
  const actualDiff: Record<string, unknown> = {}
  const expectedDiff: Record<string, unknown> = {}
  let missingCount = 0
  let extraCount = 0
  let diffCount = 0

  function addDiff(f: string, exp?: VolumeMapEntry, act?: VolumeMapEntry) {
    if (act) actualDiff[f] = makeEntryPreview(f, act)
    if (exp) expectedDiff[f] = makeEntryPreview(f, exp)
  }

  function addMatch(f: string) {
    actualDiff[f] = {}
    expectedDiff[f] = {}
  }

  const filesToCheck =
    listMatch === 'ignore-extra'
      ? expected
      : listMatch === 'ignore-missing'
        ? received
        : { ...received, ...expected }
  for (const f in filesToCheck) {
    const exp = expected[f]
    const act = received[f]

    if (exp && act) {
      if (exp.type !== act.type) {
        addDiff(f, exp, act)
        diffCount++
      } else if (exp.type === 'file') {
        if (!exp.data.equals((act as typeof exp).data)) {
          addDiff(f, exp, act)
          diffCount++
        } else {
          addMatch(f)
        }
      } else if (exp.type === 'symlink') {
        if (exp.target !== (act as typeof exp).target) {
          addDiff(f, exp, act)
          diffCount++
        } else {
          addMatch(f)
        }
      } else {
        addMatch(f)
      }
    } else if (exp && !act && listMatch !== 'ignore-missing') {
      addDiff(f, exp)
      missingCount++
    } else if (act && !exp && listMatch !== 'ignore-extra') {
      addDiff(f, null, act)
      extraCount++
    }
  }

  const total = missingCount + extraCount + diffCount
  if (total > 0) {
    const parts: string[] = []
    if (missingCount) parts.push(`${missingCount} missing path${missingCount > 1 ? 's' : ''}`)
    if (extraCount) parts.push(`${extraCount} unexpected path${extraCount > 1 ? 's' : ''}`)
    if (diffCount) parts.push(`${diffCount} mismatched content`)

    return {
      pass: false,
      message: () =>
        parts.length === 1
          ? `Found ${parts[0]}` //
          : `Found ${total} mismatches: ${parts.join(', ')}`,
      actual: actualDiff,
      expected: expectedDiff,
    }
  }

  return { pass: true, message: () => 'volumes matched' }
}

function makeEntryPreview(name: string, entry: VolumeMapEntry) {
  if (entry.type === 'empty-dir') {
    return new Directory()
  }
  if (entry.type === 'file') {
    if (isText(name, entry.data)) {
      return new TextFile(entry.data)
    }
    return new BinaryFile(entry.data)
  }
  return new Symlink(entry.target)
}

class TextFile {
  data: string
  constructor(buff: Buffer) {
    this.data = buff.toString('utf8')
  }
}

class BinaryFile {
  hash: string
  length: number
  preview: string
  constructor(buff: Buffer, trim = 32) {
    this.hash = createHash('sha1').update(buff).digest('hex')
    this.length = buff.length
    const head = buff.subarray(0, trim).toString('base64')
    const tail = buff.subarray(buff.length - trim).toString('base64')
    this.preview = `${head}...${tail}`
  }
}

class Symlink {
  constructor(public target: string) {}
}

class Directory {}
