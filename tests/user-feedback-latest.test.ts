import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function rulesFor(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').some((candidate) => candidate.trim() === selector))
    .map((match) => match[2])
}

describe('latest product feedback regressions', () => {
  it('keeps run title and orchestration wrappers as layout-only containers', async () => {
    const css = await readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8')

    for (const selector of ['.history-run-title', '.role-card-wrap']) {
      const declarations = rulesFor(css, selector).join('\n')
      expect(declarations, `${selector} must not render a second glass card`).not.toMatch(/(?:^|;)\s*(?:border(?:-radius)?|background|box-shadow|backdrop-filter)\s*:/)
    }
  })

  it('does not mount or package a launch animation', async () => {
    const [app, packageJson] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'package.json'), 'utf8')
    ])

    expect(app).not.toContain('LaunchBrandAnimation')
    expect(app).not.toContain('foreman-seal-intro.mp4')
    expect(packageJson).not.toContain('render:intro')
  })

  it('exposes a one-click TencentDB local setup action through the secure bridge', async () => {
    const [app, preload, main] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'src', 'preload', 'index.ts'), 'utf8'),
      readFile(join(root, 'src', 'main', 'index.ts'), 'utf8')
    ])

    expect(app).toContain('一键配置并启动')
    expect(preload).toContain("ipcRenderer.invoke('memory:tencentdb:setup'")
    expect(main).toContain("ipcMain.handle('memory:tencentdb:setup'")
  })
})
