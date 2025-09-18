import { expect } from 'vitest'

import toMatchVolume from './toMatchVolume'
import toMatchVolumeSnapshot from './toMatchVolumeSnapshot'

// Register all matchers
expect.extend({ toMatchVolume, toMatchVolumeSnapshot })
