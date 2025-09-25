import { createHash } from 'node:crypto'
import { isText } from 'istextorbinary'
import type { VolumeMap, VolumeEntry } from './volume.js'

export type VolumeCompareListMatch =
  | 'exact' // directory contents must match exactly (default)
  | 'ignore-extra' // extra files in the received volume are ignored
  | 'ignore-missing' // missing files in the received volume are ignored

export type VolumeCompareContentMatch =
  | 'all' // compare file contents + symlink targets (default)
  | 'ignore' // ignore both, only check path + type
  | 'ignore-files' // only ignore file content comparison
  | 'ignore-symlinks' // only ignore symlink targets

export type VolumeCompareReportType =
  | 'first' // stop on the first mismatch (default)
  | 'all' // collect all mismatches and show a combined diff

export interface VolumeCompareOptions {
  // How to match the directory structure of the received volume to the expected volume.
  listMatch?: VolumeCompareListMatch
  // How to match the file contents of the received volume to the expected volume.
  contentMatch?: VolumeCompareContentMatch
  // How to report mismatches between the received volume and the expected volume.
  report?: VolumeCompareReportType
}

type VolumeCompareResult =
  | { pass: true }
  | { pass: false; message: () => string; actual: DiffEntry; expected: DiffEntry }

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
    return compareVolumeMapsAll(received, expected, options)
  }

  return compareVolumeMapsFirst(received, expected, options)
}

export function compareVolumeMapsFirst(
  received: VolumeMap,
  expected: VolumeMap,
  options?: Omit<VolumeCompareOptions, 'report'>,
): VolumeCompareResult {
  const { listMatch, contentMatch } = options ?? {}
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
          reason: `Volume is missing ${missing.length} expected file${missing.length > 1 ? 's' : ''}`,
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
          reason: `Volume has ${extra.length} unexpected file${extra.length > 1 ? 's' : ''}`,
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
          reason: 'Directory structure didn’t match',
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

  const matchEntry = makeDiffMatcher(contentMatch)
  const filesToCheck = listMatch === 'ignore-missing' ? actualFiles : expectedFiles
  for (const file of filesToCheck) {
    const { kind, exp, act } = matchEntry(file, expected[file], received[file])
    if (kind === DiffKind.TypeMismatch) {
      return {
        pass: false,
        message: () => `Found path type mismatch at \`${file}\``,
        actual: act,
        expected: exp,
      }
    }
    if (kind === DiffKind.FileMismatch) {
      return {
        pass: false,
        message: () => `Found file content mismatch at \`${file}\``,
        actual: act,
        expected: exp,
      }
    }
    if (kind === DiffKind.SymlinkMismatch) {
      return {
        pass: false,
        message: () => `Found symlink target mismatch at \`${file}\``,
        actual: act,
        expected: exp,
      }
    }
  }

  return { pass: true }
}

export function compareVolumeMapsAll(
  received: VolumeMap,
  expected: VolumeMap,
  options?: Omit<VolumeCompareOptions, 'report'>,
): VolumeCompareResult {
  const { listMatch, contentMatch } = options ?? {}
  const ignoreMissingPaths = listMatch === 'ignore-missing'
  const ignoreExtraPaths = listMatch === 'ignore-extra'
  const matchEntry = makeDiffMatcher(contentMatch)

  const actualDiff: Record<string, DiffEntry> = {}
  const expectedDiff: Record<string, DiffEntry> = {}
  let missingCount = 0
  let extraCount = 0
  let contentCount = 0
  let typeCount = 0

  const pathsToCheck = ignoreExtraPaths
    ? expected
    : ignoreMissingPaths
      ? received
      : { ...received, ...expected }
  for (const p in pathsToCheck) {
    const { kind, exp, act } = matchEntry(p, expected[p], received[p])
    switch (kind) {
      case DiffKind.TypeMismatch:
        expectedDiff[p] = exp
        actualDiff[p] = act
        typeCount++
        break
      case DiffKind.FileMismatch:
      case DiffKind.SymlinkMismatch:
        expectedDiff[p] = exp
        actualDiff[p] = act
        contentCount++
        break
      case DiffKind.Missing:
        if (!ignoreMissingPaths) {
          expectedDiff[p] = exp
          missingCount++
        }
        break
      case DiffKind.Extra:
        if (!ignoreExtraPaths) {
          actualDiff[p] = act
          extraCount++
        }
        break
      case DiffKind.Match:
      default:
        actualDiff[p] = {}
        expectedDiff[p] = {}
    }
  }

  const total = missingCount + extraCount + contentCount + typeCount
  if (total > 0) {
    const parts: string[] = []
    if (missingCount) parts.push(`${missingCount} missing path${missingCount > 1 ? 's' : ''}`)
    if (extraCount) parts.push(`${extraCount} unexpected path${extraCount > 1 ? 's' : ''}`)
    if (typeCount) parts.push(`${typeCount} path type mismatch${typeCount > 1 ? 'es' : ''}`)
    if (contentCount) parts.push(`${contentCount} mismatched content`)

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

  return { pass: true }
}

type DiffEntry = Directory | File | BinaryFile | Symlink

enum DiffKind {
  Match = 0,
  TypeMismatch = 1,
  FileMismatch = 2,
  SymlinkMismatch = 3,
  Missing = 4,
  Extra = 5,
}

type DiffResult =
  | { kind: DiffKind.Match; exp?: never; act?: never }
  | { kind: DiffKind.TypeMismatch; exp: DiffEntry; act: DiffEntry }
  | { kind: DiffKind.FileMismatch; exp: DiffEntry; act: DiffEntry }
  | { kind: DiffKind.SymlinkMismatch; exp: DiffEntry; act: DiffEntry }
  | { kind: DiffKind.Missing; exp: DiffEntry; act?: never }
  | { kind: DiffKind.Extra; exp?: never; act: DiffEntry }

function makeDiffMatcher(contentMatch?: VolumeCompareContentMatch) {
  const compareFiles = contentMatch !== 'ignore' && contentMatch !== 'ignore-files'
  const compareSymlinks = contentMatch !== 'ignore' && contentMatch !== 'ignore-symlinks'

  function makeDiff(path: string, entry: VolumeEntry): DiffEntry {
    if (entry.kind === 'empty-dir') {
      return EMPTY_DIR_MARKER
    }

    if (entry.kind === 'file') {
      if (compareFiles) {
        return isText(path, entry.data) //
          ? new File(entry.data)
          : new BinaryFile(entry.data)
      }

      return EMPTY_FILE_MARKER
    }

    return compareSymlinks //
      ? new Symlink(entry.target)
      : EMPTY_SYMLINK_MARKER
  }

  function matchEntry(path: string, exp: VolumeEntry, act: VolumeEntry): DiffResult {
    if (exp && !act) {
      return { kind: DiffKind.Missing, exp: makeDiff(path, exp) }
    }

    if (act && !exp) {
      return { kind: DiffKind.Extra, act: makeDiff(path, act) }
    }

    const expKind = exp.kind
    const actKind = act.kind

    if (expKind !== actKind) {
      return { kind: DiffKind.TypeMismatch, exp: makeDiff(path, exp), act: makeDiff(path, act) }
    }

    if (expKind === 'file' && compareFiles && !exp.data.equals((act as typeof exp).data)) {
      return { kind: DiffKind.FileMismatch, exp: makeDiff(path, exp), act: makeDiff(path, act) }
    }

    if (expKind === 'symlink' && compareSymlinks && exp.target !== (act as typeof exp).target) {
      return { kind: DiffKind.SymlinkMismatch, exp: makeDiff(path, exp), act: makeDiff(path, act) }
    }

    return { kind: DiffKind.Match }
  }

  return matchEntry
}

class Directory {}

class File {
  declare data?: string
  constructor(buff?: Buffer) {
    if (buff) {
      this.data = buff.toString('utf8')
    }
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
    const tail = buff.length > trim ? buff.subarray(-trim).toString('base64') : null
    this.preview = tail ? `${head}...${tail}` : head
  }
}

class Symlink {
  declare target?: string
  constructor(target?: string) {
    if (target != null) {
      this.target = target
    }
  }
}

const EMPTY_DIR_MARKER = Object.freeze(new Directory())
const EMPTY_FILE_MARKER = Object.freeze(new File())
const EMPTY_SYMLINK_MARKER = Object.freeze(new Symlink())
