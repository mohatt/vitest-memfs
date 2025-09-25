# [1.2.0](https://github.com/mohatt/vitest-memfs/compare/v1.1.0...v1.2.0) (2025-09-25)


### Features

* add `toHaveVolumeEntries` matcher ([87c9568](https://github.com/mohatt/vitest-memfs/commit/87c9568313022136c20a74be338e9666942b4965))

# [1.1.0](https://github.com/mohatt/vitest-memfs/compare/v1.0.1...v1.1.0) (2025-09-23)


### Bug Fixes

* **diff:** fix binary file preview diffs ([cabdc26](https://github.com/mohatt/vitest-memfs/commit/cabdc269d00895ae56bf9363d79ab8609ce3e474))


### Features

* **compare:** add `contentMatch` option and improve diff reporting ([85e0101](https://github.com/mohatt/vitest-memfs/commit/85e01014cf8a333cceddd5d32ba0d523bc6a8d90))


### Performance Improvements

* **fs:** improve volume handling and async I/O operations using `p-limit` ([f96c018](https://github.com/mohatt/vitest-memfs/commit/f96c01870f0ee62d0370cb489a352e0220c5e8d4))

## [1.0.1](https://github.com/mohatt/vitest-memfs/compare/v1.0.0...v1.0.1) (2025-09-22)


### Bug Fixes

* **toMatchVolumeSnapshot:** respect Vitest's `updateSnapshot=none` ([5b5a079](https://github.com/mohatt/vitest-memfs/commit/5b5a0798fea3b1289e03b47c31f5963e99bddaaf))

# 1.0.0 (2025-09-22)

🚀 First release.

### Bug Fixes

* improve mismatch messages, update snapshots ([c285299](https://github.com/mohatt/vitest-memfs/commit/c28529998d914a53c418ac9dbedee0d2bcf6ab1c))
* use `readdirSync` instead of `toSnapshotSync` ([aae6fbd](https://github.com/mohatt/vitest-memfs/commit/aae6fbde8701764c8fa0f7b4596eeb46a5b7d4a4))


### Features

* add `report=all` option, use esm imports ([849d4b9](https://github.com/mohatt/vitest-memfs/commit/849d4b931338b5f6f300e6422ed0cf85eea683c4))
* add vitest setup script ([fe5b138](https://github.com/mohatt/vitest-memfs/commit/fe5b1385789b7e350ac021c302db8f57f7d047b9))
* support `DirectoryJSON` as expected input ([5872ada](https://github.com/mohatt/vitest-memfs/commit/5872ada96005ff1114dfc89d8c1622bebcd6be00))
