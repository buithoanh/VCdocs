import { spawnSync } from 'node:child_process';

const result=spawnSync('docker',['compose','--env-file','/private/tmp/vcworkspace-mail08-cli.env','-f','poc/mail-stalwart/compose.yaml','up','-d','--no-deps','--force-recreate','relay'],{cwd:process.cwd(),stdio:'inherit',env:process.env});
process.exit(result.status??1);
