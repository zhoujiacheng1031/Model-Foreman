import { isWindowsEnvironment } from './cli-environment'

export interface CommandInvocation { command: string; args: string[] }

/** Launches npm .cmd/.bat shims through cmd.exe without enabling a general shell. */
export function commandInvocation(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): CommandInvocation {
  if (!isWindowsEnvironment(env) || !/\.(?:cmd|bat)$/i.test(command)) return { command, args }
  const shell = env.ComSpec || env.COMSPEC || 'cmd.exe'
  const line = `"${[command, ...args].map(cmdQuote).join(' ')}"`
  return { command: shell, args: ['/d', '/s', '/c', line] }
}

function cmdQuote(value: string): string {
  return `"${value.replace(/%/g, '%%').replace(/"/g, '""')}"`
}
