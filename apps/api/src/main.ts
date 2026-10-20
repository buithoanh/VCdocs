import { Logger } from '@nestjs/common';
import { loadConfig, loadDotEnv } from './config/config';
import { createApp } from './bootstrap';
import { DemoSeedService } from './seed/demo-seed.service';
import { SchedulerService } from './modules/scheduler/scheduler.service';

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const app = await createApp(cfg);
  if (cfg.seedDemo) await app.get(DemoSeedService).seedIfEmpty();
  if (cfg.schedulerEnabled) app.get(SchedulerService).start();
  await app.listen(cfg.port);
  new Logger('VCdocs').log(`API chạy ở ${cfg.publicApiOrigin}/api/v1 (Google: ${cfg.googleMode})`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
