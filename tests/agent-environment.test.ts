import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentEnvironmentService } from '../src/main/agent-environment'

async function skill(path: string, name: string, description: string) {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions.`)
}

describe('agent environment discovery', () => {
  it('发现 Desktop、原生作用域、Plugin 命名空间与重名冲突', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foreman-env-'))
    const home = join(root, 'home')
    const workspace = join(root, 'repo', 'packages', 'app')
    const applications = join(root, 'Applications')
    await mkdir(join(root, 'repo', '.git'), { recursive: true })
    await mkdir(join(applications, 'ChatGPT.app'), { recursive: true })
    await skill(join(root, 'repo', '.agents', 'skills', 'review'), 'review', 'Project review')
    await skill(join(home, '.agents', 'skills', 'review'), 'review', 'User review')
    await skill(join(workspace, '.claude', 'skills', 'deploy'), 'deploy', 'Deploy safely')
    await skill(join(home, '.claude', 'plugins', 'cache', 'market', 'quality', '1.2.0', 'skills', 'audit'), 'audit', 'Audit changes')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'config.toml'), `[[skills.config]]\npath = "${join(home, '.agents', 'skills', 'review', 'SKILL.md')}"\nenabled = false\n`)
    await mkdir(join(workspace, '.claude'), { recursive: true })
    await writeFile(join(workspace, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { deploy: 'off' }, enabledPlugins: { 'quality@market': false } }))

    const service = new AgentEnvironmentService({ home, applicationRoots: [applications], adminCodexRoot: join(root, 'admin') })
    const environment = await service.inspect(workspace)

    expect(environment.desktops.find((item) => item.kind === 'codex')?.installed).toBe(true)
    expect(environment.desktops.find((item) => item.kind === 'claude')?.installed).toBe(false)
    expect(environment.skills.filter((item) => item.invocation === '$review')).toHaveLength(2)
    expect(environment.skills.filter((item) => item.invocation === '$review').every((item) => item.conflict)).toBe(true)
    expect(environment.skills.find((item) => item.path === join(home, '.agents', 'skills', 'review', 'SKILL.md'))?.enabled).toBe(false)
    expect(environment.skills.find((item) => item.invocation === '/deploy' && item.scope === 'project')?.enabled).toBe(false)
    expect(environment.skills.find((item) => item.invocation === '/quality:audit' && item.scope === 'plugin')?.enabled).toBe(false)
  })
})
