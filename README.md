# vitest-memfs

[![][npm-img]][npm-url] [![][ci-img]][ci-url] [![][codecov-img]][codecov-url] [![][license-img]][license-url]

Custom [Vitest](https://vitest.dev) matchers for working with [memfs](https://github.com/streamich/memfs).
Useful when testing code that reads/writes to the filesystem without touching the real disk.

- [Usage](#usage)
- [Matchers](#matchers)
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
// `vite.config.js`
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['tests-setup.ts'],
  },
})
```

Then extend Vitest’s matchers in your setup file:

```typescript
// tests-setup.ts

// Register all matchers
import 'vitest-memfs/setup'

// Or only the ones you need
import { toMatchVolume } from 'vitest-memfs/matchers'
expect.extend({ toMatchVolume })
```

## Matchers

### toMatchVolume

Compare two `memfs` volumes (or a volume vs. JSON input).

```typescript
import { Volume } from 'memfs'

it('compares volumes', () => {
  const vol1 = Volume.fromJSON({ '/foo.txt': 'hello' })
  const vol2 = Volume.fromJSON({ '/foo.txt': 'hello' })

  expect(vol1).toMatchVolume(vol2) // ✅ passes
  expect(vol1).toMatchVolume({ '/foo.txt': 'world' }) // ❌ mismatch in file "/foo.txt"
})
```

### toMatchVolumeSnapshot

Persist an entire `memfs` volume as a directory on disk and compare against it later.
This works like Vitest’s `toMatchSnapshot`, but for filesystem trees.

```typescript
import { Volume } from 'memfs'

it('matches volume snapshot', () => {
  const vol = Volume.fromJSON({ '/foo.txt': 'hello' })
  expect(vol).toMatchVolumeSnapshot('foo-snap')
})
```

- On first run (or when using `-u`), a real directory is created under `__snapshots__/`.
- On later runs, the volume is compared against that directory.

### Options

Both matchers support the same options:

```typescript
interface VolumeMatcherOptions {
  prefix?: string
  listMatch?: 'exact' | 'ignore-extra' | 'ignore-missing'
  report?: 'first' | 'all'
}
```

- **prefix**
  - `subdirectory` → Limit comparisons to files under the given path (e.g. `/src`).
- **listMatch**
  - `exact` → directory contents must match exactly (default).
  - `ignore-extra` → extra files in the received volume are ignored.
  - `ignore-missing` → missing files in the received volume are ignored.
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
