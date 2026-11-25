import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const [harness, model, ...testArgs] = process.argv.slice(2)
if (!['codex', 'claude', 'zcode'].includes(harness) || !model) {
  console.error('Usage: npm run test:harness -- <codex|claude|zcode> <model>\nUses the locally authenticated CLI and consumes real model quota. Runs only in a temporary Git repository.')
  process.exit(2)
}
const require = createRequire(import.meta.url)
const result = spawnSync(process.execPath, [require.resolve('vitest/vitest.mjs'), 'run', 'tests/runtime-harness.test.ts', ...testArgs], {
  stdio: 'inherit', env: { ...process.env, FOREMAN_REAL_HARNESS: harness, FOREMAN_HARNESS_MODEL: model }
})
process.exit(result.status ?? 1)
