import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const result = spawnSync('xattr', ['-cr', app], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`无法清理 macOS 打包元数据：${result.stderr || result.stdout}`)
}
