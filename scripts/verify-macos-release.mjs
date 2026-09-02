import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('macOS 验证只能在 Mac 上执行')
const release='release'; const appCandidates=['mac-arm64','mac','mac-universal','mac-x64'].map((dir)=>join(release,dir,'Model Foreman.app'))
const app=appCandidates.find((path)=>spawnSync('test',['-d',path]).status===0)
if(!app) throw new Error('找不到 Model Foreman.app')
run('codesign',['--verify','--deep','--strict','--verbose=2',app])
run('spctl',['--assess','--verbose=2','--type','exec',app])
run('xcrun',['stapler','validate',app])
for(const name of readdirSync(release).filter((value)=>value.endsWith('.dmg'))) {
  const dmg=join(release,name); run('xcrun',['stapler','validate',dmg]); run('spctl',['--assess','--verbose=2','--type','open','--context','context:primary-signature',dmg])
}
console.log('Signed and notarized macOS release verified.')
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1)}
