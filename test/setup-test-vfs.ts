// Register all vitest-memfs matchers
import { vi } from 'vitest'
import '@/setup.js'

// Use virtual file system global mocks
vi.mock('fs')
vi.mock('fs/promises')
