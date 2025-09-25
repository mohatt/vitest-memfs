# vitest-memfs

[![][npm-img]][npm-url] [![][ci-img]][ci-url] [![][codecov-img]][codecov-url] [![][license-img]][license-url]

Custom [Vitest](https://vitest.dev) matchers for working with [memfs](https://github.com/streamich/memfs).

Useful when testing code that reads/writes to the filesystem without touching the real disk.

- [Usage](#usage)
- [Matchers](#matchers)
  - [toHaveVolumeEntries](#toHaveVolumeEntries)
  - [toMatchVolume](#toMatchVolume)
  - [toMatchVolumeSnapshot](#toMatchVolumeSnapshot)
  - [Options](#options)
- [License](#license)

## Usage

Install with your favorite package manager:

```sh
$ pnpm add -D vitest-memfs
```

Add a setup file to your Vitest config:

```javascript
// `vite.config.ts`
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['tests-setup.ts'],
  },
})
```

Setup file:

```typescript
// `tests-setup.ts`

// Register all matchers
import 'vitest-memfs/setup'

// Or only the ones you need
import { toMatchVolume } from 'vitest-memfs/matchers'
expect.extend({ toMatchVolume })
```

## Matchers

### toHaveVolumeEntries

Checks that certain paths or glob patterns exist in a `memfs` volume, with optional type checks.

```typescript
import { Volume } from 'memfs'

it('checks that paths are present', () => {
  const vol = Volume.fromJSON({
    '/package.json': '{}',
    '/foo.txt': 'hello',
    '/src/index.ts': 'export {}',
    '/src/utils/math.ts': 'export const add = () => {}',
  })

  // exact paths
  expect(vol).toHaveVolumeEntries(['/foo.txt', '/src'])
  // with type checks
  expect(vol).toHaveVolumeEntries({
    '/foo.txt': 'file',
    '/src': 'dir',
  })

  // glob patterns
  expect(vol).toHaveVolumeEntries(['*.txt', 'src/**/*.ts'])
  expect(vol).toHaveVolumeEntries({ 'src/**/*.ts': { count: 3 } }) // ❌ found 2/3 files

  // prefix + relative paths
  expect(vol).toHaveVolumeEntries(['/foo.txt', 'utils/*.ts'], { prefix: '/src' })

  // negated assertions
  expect(vol).not.toHaveVolumeEntries(['package.json', 'src/**/*.ts'])
})
```

**Supported Input Formats:**

```typescript
// string — single path or glob
expect(vol).toHaveVolumeEntries('/foo.txt')
expect(vol).toHaveVolumeEntries('src/**/*.ts')

// array — mix of strings or objects
expect(vol).toHaveVolumeEntries(['/foo.txt', { path: 'src/**/*.ts', type: 'file', count: 2 }])

// object — mapping of path/glob → type or options
expect(vol).toHaveVolumeEntries({
  '/foo.txt': 'file',
  'src/**/*.ts': { type: 'file', count: 2 },
})
```

**Notes:**

- Supports exact paths and glob patterns (negated globs like `!**/*.d.ts` are not supported).
- Types can be `file` | `dir` | `symlink` | `any` (default).
- `count` can enforce a minimum number of matches (default: `1`).
- Only existence/type are checked — file contents and symlink targets are ignored.

### toMatchVolume

Compare two `memfs` volumes (or a volume vs. JSON input).

```typescript
import { Volume } from 'memfs'

it('compares volumes', () => {
  const vol1 = Volume.fromJSON({ '/foo.txt': 'hello' })
  const vol2 = Volume.fromJSON({ '/foo.txt': 'hello' })

  expect(vol1).toMatchVolume(vol2) // ✅ passes
  expect(vol1).toMatchVolume({ '/foo.txt': 'world' }) // ❌ mismatch in file "/foo.txt"

  // prefix
  const vol3 = Volume.fromJSON({ '/foo.txt': 'hello', '/src/bar.txt': 'world' })
  expect(vol3).toMatchVolume({ '/src/bar.txt': 'world' }, { prefix: '/src' })
  // ✅ passes: only `/src/bar.txt` is compared

  // listMatch: 'ignore-extra'
  expect(vol3).toMatchVolume({ '/src/bar.txt': 'world' }, { listMatch: 'ignore-extra' })
  // ✅ passes: ignore extra files in received volume
})
```

### toMatchVolumeSnapshot

Persist an entire `memfs` volume as a directory on disk and compare against it later.

This works like Vitest’s `toMatchSnapshot`, but for filesystem trees.

```typescript
import { Volume } from 'memfs'

it('matches volume snapshot', async () => {
  const vol = Volume.fromJSON({ '/foo.txt': 'hello' })
  await expect(vol).toMatchVolumeSnapshot('foo-snap')

  // prefix
  const vol3 = Volume.fromJSON({ '/foo.txt': 'hello', '/src/bar.txt': 'world' })
  await expect(vol3).toMatchVolumeSnapshot('src-snap', { prefix: '/src' })
  // only files under `/src` are persisted/compared
})
```

- On first run (or when using `-u`), a real directory is created under `__snapshots__/`.
- On later runs, the volume is compared against that directory.

### Options

Both `toMatchVolume` and `toMatchVolumeSnapshot` support the same options:

```typescript
interface VolumeMatcherOptions {
  prefix?: string
  listMatch?: 'exact' | 'ignore-extra' | 'ignore-missing'
  contentMatch?: 'all' | 'ignore' | 'ignore-files' | 'ignore-symlinks'
  report?: 'first' | 'all'
}
```

- **prefix**
  - `subdirectory` → Limit comparisons to files under the given path (e.g. `/src`).
- **listMatch**
  - `exact` → directory contents must match exactly (default).
  - `ignore-extra` → extra files in the received volume are ignored.
  - `ignore-missing` → missing files in the received volume are ignored.
- **contentMatch**
  - `all` → compare file contents and symlink targets (default).
  - `ignore` → only check that paths and path types match. Useful if you don’t care about the actual contents.
  - `ignore-files` → only ignore file content comparison.
  - `ignore-symlinks` → only ignore symlink target comparison.
- **report**
  - `first` → stop on the first mismatch (default).
  - `all` → collect all mismatches and show a combined diff.

## License

[MIT][license-url]

[npm-url]: https://www.npmjs.com/package/vitest-memfs
[npm-img]: https://img.shields.io/npm/v/vitest-memfs.svg?logo=npm
[ci-url]: https://github.com/mohatt/vitest-memfs/actions/workflows/ci.yml
[ci-img]: https://img.shields.io/github/actions/workflow/status/mohatt/vitest-memfs/ci.yml?branch=main&logo=github
[codecov-url]: https://codecov.io/github/mohatt/vitest-memfs
[codecov-img]: https://img.shields.io/codecov/c/github/mohatt/vitest-memfs.svg?logo=codecov&logoColor=white
[license-url]: https://github.com/mohatt/vitest-memfs/blob/main/LICENSE
[license-img]: https://img.shields.io/github/license/mohatt/vitest-memfs.svg?logo=open%20source%20initiative&logoColor=white
