import type { ContractStep } from '../../shared/contracts'

export function dependencies(steps: ContractStep[], index: number): string[] {
  // Older contracts were ordered lists. Missing metadata must not introduce concurrency.
  return steps[index].dependsOn ?? steps.slice(0, index).map((step) => step.id)
}

export function validateDependencies(steps: ContractStep[]): void {
  const ids = new Set(steps.map((step) => step.id))
  if (ids.size !== steps.length) throw new Error('执行步骤 ID 必须唯一')
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (id: string) => {
    if (!ids.has(id)) throw new Error(`依赖步骤不存在：${id}`)
    if (visiting.has(id)) throw new Error(`步骤依赖存在循环：${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dep of dependencies(steps, steps.findIndex((step) => step.id === id))) visit(dep)
    visiting.delete(id); visited.add(id)
  }
  steps.forEach((step) => visit(step.id))
}

export function fileScope(value: string): string {
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..') || /[*?\[\]\x00-\x1f]/.test(path) || path.split('/').some((part) => part.toLowerCase() === '.git' || part.toLowerCase() === '.foreman')) throw new Error(`请指定仓库内明确的文件或目录范围：${value}`)
  return path
}

export function overlaps(a: string[], b: string[]): boolean {
  // An unspecified scope is exclusive. Case folding is conservative on case-insensitive hosts.
  return !a.length || !b.length || a.some((x) => b.some((y) => {
    x = fileScope(x).toLowerCase(); y = fileScope(y).toLowerCase()
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
  }))
}

export function owns(files: string[], path: string): boolean {
  return !files.length || files.some((scope) => path === fileScope(scope) || path.startsWith(`${fileScope(scope)}/`))
}
