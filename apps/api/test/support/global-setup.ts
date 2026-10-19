import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';

/** Một MongoDB trong bộ nhớ cho cả lượt test; mỗi file test dùng một CSDL riêng. */
export default async function globalSetup() {
  process.env.MONGOMS_SYSTEM_BINARY = process.env.MONGOMS_SYSTEM_BINARY || '/usr/local/bin/mongod';
  const server = await MongoMemoryServer.create();
  (globalThis as any).__MONGOD__ = server;
  process.env.TEST_MONGO_URI = server.getUri();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcdocs-cov-'));
  process.env.TEST_COVERAGE_DIR = dir;
}
