import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NextcloudStorage, StorageError, parseDavMultistatus,
} from '../src/nextcloud-storage.mjs';

const davXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
 <d:response><d:href>/remote.php/dav/files/a/department/</d:href>
  <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype>
   <d:getetag>&quot;folder-etag&quot;</d:getetag></d:prop>
   <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/a/department/mau%20thu.txt</d:href>
  <d:propstat><d:prop><d:resourcetype></d:resourcetype>
   <d:getcontentlength>23</d:getcontentlength><d:getetag>&quot;file&amp;etag&quot;</d:getetag>
   </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  <d:propstat><d:prop><d:displayname>ignored</d:displayname></d:prop>
   <d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
</d:multistatus>`;

test('DAV parser reads only successful propstat and collection variants', () => {
  const entries = parseDavMultistatus(davXml);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    href: '/remote.php/dav/files/a/department/', kind: 'folder', size: 0,
    etag: '"folder-etag"',
  });
  assert.equal(entries[1].href.endsWith('/mau thu.txt'), true);
  assert.equal(entries[1].kind, 'file');
  assert.equal(entries[1].size, 23);
  assert.equal(entries[1].etag, '"file&etag"');
});

test('stat and list use parsed DAV responses', async () => {
  const storage = new NextcloudStorage({
    baseUrl: 'http://127.0.0.1:18080', username: 'a', requestHeaders: {},
    fetchImpl: async () => new Response(davXml, { status: 207 }),
  });
  const stat = await storage.stat('department');
  assert.equal(stat.kind, 'folder');
  const children = await storage.list('department');
  assert.deepEqual(children, ['/remote.php/dav/files/a/department/mau thu.txt']);
});

test('network and timeout failures map to neutral storage errors', async () => {
  const unavailable = new NextcloudStorage({
    baseUrl: 'http://127.0.0.1:18080', username: 'a', requestHeaders: {},
    fetchImpl: async () => { throw new TypeError('connection refused'); },
  });
  await assert.rejects(unavailable.stat('department'),
    (error) => error instanceof StorageError && error.code === 'STORAGE_UNAVAILABLE');
  const timeout = new NextcloudStorage({
    baseUrl: 'http://127.0.0.1:18080', username: 'a', requestHeaders: {},
    fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); },
  });
  await assert.rejects(timeout.stat('department'),
    (error) => error instanceof StorageError && error.code === 'STORAGE_TIMEOUT');
});

test('PROPFIND without a successful propstat is rejected', async () => {
  const badXml = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/x</d:href>'
    + '<d:propstat><d:prop/><d:status>HTTP/1.1 404 Not Found</d:status>'
    + '</d:propstat></d:response></d:multistatus>';
  const storage = new NextcloudStorage({
    baseUrl: 'http://127.0.0.1:18080', username: 'a', requestHeaders: {},
    fetchImpl: async () => new Response(badXml, { status: 207 }),
  });
  await assert.rejects(storage.stat('x'),
    (error) => error instanceof StorageError && error.code === 'STORAGE_STATE_CONFLICT');
});
