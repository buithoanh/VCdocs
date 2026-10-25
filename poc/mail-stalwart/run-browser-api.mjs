import { spawnSync } from 'node:child_process';

const result=spawnSync('pnpm',['--filter','@vcdocs/api','test','--','--runInBand','test/mail-browser-smoke-server.spec.ts'],{
  cwd:process.cwd(),stdio:'inherit',env:{...process.env,RUN_MAIL_BROWSER_SMOKE:'1',ALLOW_PARTIAL_COVERAGE:'1',BROWSER_SMOKE_HOLD_MS:process.env.BROWSER_SMOKE_HOLD_MS||'600000'},
});
process.exit(result.status??1);
