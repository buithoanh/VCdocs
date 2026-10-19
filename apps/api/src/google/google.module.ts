import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { FakeGoogle } from './fake/fake-google';
import { createRealGoogle } from './real/real-google';
import { GOOGLE, VAULT } from './ports';
import { FsVault, MemoryVault } from './vault';

@Global()
@Module({
  providers: [
    {
      provide: GOOGLE,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.googleMode === 'real'
          ? createRealGoogle(cfg)
          : new FakeGoogle({ publicApiOrigin: cfg.publicApiOrigin, stateFile: cfg.google.fakeStateFile }),
    },
    { provide: VAULT, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => (cfg.vaultDir === ':memory:' ? new MemoryVault() : new FsVault(cfg.vaultDir)) },
  ],
  exports: [GOOGLE, VAULT],
})
export class GoogleModule {}
