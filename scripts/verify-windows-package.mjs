import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { extractFile } from '@electron/asar'

const root = process.cwd()
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const name = `Model-Foreman-Setup-${version}-x64.exe`
const installer = path.join(root, 'release', name)
const sevenZip = process.argv[2] || '7z'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-windows-package-'))
const digest = data => crypto.createHash('sha256').update(data).digest('hex')

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`)
  return result.stdout.trim()
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? files(file) : entry.name === '.DS_Store' ? [] : [file]
  })
}
function peMachine(file) {
  const data = fs.readFileSync(file)
  if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Missing PE DOS header')
  const offset = data.readUInt32LE(0x3c)
  if (data.toString('ascii', offset, offset + 4) !== 'PE\0\0') throw new Error('Missing PE signature')
  return data.readUInt16LE(offset + 4)
}

try {
  peMachine(installer)
  const outer = path.join(temporary, 'installer')
  run(sevenZip, ['x', installer, `-o${outer}`, '-y'])
  const archives = files(outer).filter(file => path.basename(file) === 'app-64.7z')
  if (archives.length !== 1) throw new Error('Expected exactly one x64 NSIS application payload')
  const payload = path.join(temporary, 'payload')
  run(sevenZip, ['x', archives[0], `-o${payload}`, '-y'])
  const executables = files(payload).filter(file => path.basename(file) === 'Model Foreman.exe')
  const archivesAsar = files(payload).filter(file => path.basename(file) === 'app.asar')
  if (executables.length !== 1 || peMachine(executables[0]) !== 0x8664) throw new Error('Application payload is not x64')
  if (archivesAsar.length !== 1) throw new Error('Missing or ambiguous application archive')
  const archive = archivesAsar[0]
  const archiveVersion = JSON.parse(extractFile(archive, 'package.json').toString()).version
  if (archiveVersion !== version) throw new Error(`Package version mismatch: ${archiveVersion}`)
  const verifiedFiles = files(path.join(root, 'out')).sort().map(file => {
    const relative = path.relative(root, file).split(path.sep).join('/')
    const expected = fs.readFileSync(file)
    const actual = extractFile(archive, relative)
    const sha256 = digest(expected)
    if (actual.length !== expected.length || digest(actual) !== sha256) throw new Error(`Installer payload mismatch: ${relative}`)
    return { file: relative, sizeBytes: actual.length, sha256, status: 'passed' }
  })
  const report = {
    version,
    sourceCommit: process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']),
    verifiedAt: new Date().toISOString(),
    platform: 'windows', architecture: 'x64', signature: 'unsigned',
    installerPayload: 'extracted-and-verified', archiveVersion,
    bundleFilesVerified: verifiedFiles.length, files: verifiedFiles,
    artifact: { file: name, sizeBytes: fs.statSync(installer).size, sha256: digest(fs.readFileSync(installer)) },
    runtimeAcceptance: 'not-performed'
  }
  fs.writeFileSync(path.join(root, 'release', `Model-Foreman-${version}-windows-verification.json`), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ version, architecture: report.architecture, bundleFilesVerified: verifiedFiles.length, sha256: report.artifact.sha256 }, null, 2))
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
