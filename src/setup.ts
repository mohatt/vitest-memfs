import { expect } from 'vitest'
import * as matchers from './matchers'

// Register all matchers
expect.extend(matchers)

// Needed for global matcher types to be available
export type {} from './matchers'
