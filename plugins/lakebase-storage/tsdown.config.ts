import { defineConfig } from 'tsdown'
export default defineConfig({ entry: { index: 'src/index.ts', 'import-sqlite': 'src/import-cli.ts' }, outDir: 'lib', format: 'esm', target: 'es2024', platform: 'node', fixedExtension: false, dts: true,
  deps: { neverBundle: [/^dsh-superagent(?:\/|$)/, /^@deepseek-ai\//, 'pg-native', 'zod'] } })
