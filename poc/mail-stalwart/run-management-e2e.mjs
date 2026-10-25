import { spawnSync } from 'node:child_process';

const result=spawnSync('pnpm',['--filter','@vcdocs/api','test','--','--runInBand','test/mail-management.e2e-spec.ts'],{
  cwd:process.cwd(),stdio:'inherit',env:{...process.env,RUN_MAIL_ENGINE_MANAGEMENT:'1',ALLOW_PARTIAL_COVERAGE:'1'},
});
process.exit(result.status??1);
