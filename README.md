# vitest-memfs

[![][npm-img]][npm-url] [![][ci-img]][ci-url] [![][codecov-img]][codecov-url] [![][gatsby-img]][gatsby-url] [![][license-img]][license-url]

Custom vitest matchers for interacting with memfs.

- [Usage](#usage)
- [Matchers](#matchers)
- [License](#license)

## Usage

Install with your favorite package manager:

```sh
$ pnpm add -D vitest-memfs
```

Add a setup file to your Vitest configuration:

```javascript
// in your `vite.config.js`
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['tests-setup.ts'],
  },
})
```

Extends the built-in Vitest matchers with some or all matchers of `vitest-memfs` in your setup file:

```javascript
// Use all matchers of `vitest-memfs`.
import 'vitest-memfs/matchers'

// Use some matchers of `vitest-memfs`.
import toMatchVolume from 'vitest-memfs/matchers/toMatchVolume'
expect.extend({ toMatchVolume })
```

## License

[MIT][license-url]

[npm-url]: https://www.npmjs.com/package/vitest-memfs
[npm-img]: https://img.shields.io/npm/v/vitest-memfs.svg?logo=npm
[ci-url]: https://github.com/mohatt/vitest-memfs/actions/workflows/ci.yml
[ci-img]: https://img.shields.io/github/actions/workflow/status/mohatt/vitest-memfs/ci.yml?branch=master&logo=github
[codecov-url]: https://codecov.io/github/mohatt/vitest-memfs
[codecov-img]: https://img.shields.io/codecov/c/github/mohatt/vitest-memfs.svg?logo=codecov&logoColor=white
[license-url]: https://github.com/mohatt/vitest-memfs/blob/master/LICENSE
[license-img]: https://img.shields.io/github/license/mohatt/vitest-memfs.svg?logo=open%20source%20initiative&logoColor=white
