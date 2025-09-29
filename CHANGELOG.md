## [1.3.1](https://github.com/mohatt/vitest-memfs/compare/v1.3.0...v1.3.1) (2025-09-29)


### Bug Fixes

* **toMatchVolume:** fix types and result promise when using `async` ([7d61c14](https://github.com/mohatt/vitest-memfs/commit/7d61c140e353108aa6ebd1c92f8a8240ec935bee))

# [1.3.0](https://github.com/mohatt/vitest-memfs/compare/v1.2.0...v1.3.0) (2025-09-29)


### Bug Fixes

* **toMatchVolume:** relative path resolution for JSON input ([96f3060](https://github.com/mohatt/vitest-memfs/commit/96f3060799a95473b91931189ba7872b5f0083a6))
* **util:** fix non-posix path handling in `writeVolumeToDir` ([1e96682](https://github.com/mohatt/vitest-memfs/commit/1e96682acdad0ca5690ae8374014a44fe188f0c0))
* **util:** normalize symlink targets and handle non-posix paths ([ab6f8a3](https://github.com/mohatt/vitest-memfs/commit/ab6f8a30a0eeaf31d1454df15e6f5bcbe12ae8f7))


### Features

* **compare:** add async-aware volume comparison with concurrency and deferred diffs ([1037910](https://github.com/mohatt/vitest-memfs/commit/103791096b45629542a6cbae7b4cb032d6cbf8cf))
* **util:** add `FileHandle` helper APIs for streaming, hashing, and buffered diffs with async support ([4cbfeda](https://github.com/mohatt/vitest-memfs/commit/4cbfedad441328e3afb212060bd1e08f537aa5b0))

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
