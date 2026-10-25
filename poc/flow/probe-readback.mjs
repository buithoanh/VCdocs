// Chat14 (dev aid): read-only probe of the Nextcloud APIs the receiver uses for
// readback, as the flow runner (successor-a). Prints response shapes only.
import { client, readEvidence } from './lib.mjs';

const resources = await readEvidence('resources.json');
const runner = await client('successor-a');
const show = (label, response) => console.log(`== ${label} ${response.status}\n${(typeof response.data === 'string' ? response.data : JSON.stringify(response.data)).slice(0, 1500)}\n`);
const forms = '/ocs/v2.php/apps/forms/api/v3';
const submissions = await runner.request('GET', `${forms}/forms/${resources.forms.formId}/submissions`);
show('submissions', submissions);
const first = submissions.data?.ocs?.data?.submissions?.[0];
if (first) show('submission', await runner.request('GET', `${forms}/forms/${resources.forms.formId}/submissions/${first.id}`));
show('form', await runner.request('GET', `${forms}/forms/${resources.forms.formId}`));
show('board', await runner.request('GET', `/index.php/apps/deck/api/v1.0/boards/${resources.deck.boardId}`));
show('stack', await runner.request('GET', `/index.php/apps/deck/api/v1.0/boards/${resources.deck.boardId}/stacks/${resources.deck.formsDeckStackId}`));
const rows = await runner.request('GET', `/index.php/apps/tables/api/1/tables/${resources.tables.tableId}/rows`);
show('rows', rows);
if (Array.isArray(rows.data) && rows.data[0]) show('row', await runner.request('GET', `/index.php/apps/tables/api/1/rows/${rows.data[0].id}`));
show('table', await runner.request('GET', `/index.php/apps/tables/api/1/tables/${resources.tables.tableId}`));
show('table shares', await runner.request('GET', `/index.php/apps/tables/api/1/tables/${resources.tables.tableId}/shares`));
const search = `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
 <d:basicsearch>
  <d:select><d:prop><oc:fileid/><d:displayname/></d:prop></d:select>
  <d:from><d:scope><d:href>/files/${runner.uid}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
  <d:where><d:eq><d:prop><oc:fileid/></d:prop><d:literal>${Number(process.argv[2] || 643)}</d:literal></d:eq></d:where>
 </d:basicsearch>
</d:searchrequest>`;
show('search fileid', await runner.request('SEARCH', '/remote.php/dav/', { body: search, headers: { 'Content-Type': 'text/xml' } }));
show('tags of file', await runner.request('PROPFIND', `/remote.php/dav/systemtags-relations/files/${Number(process.argv[2] || 643)}`, {
  body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:id/><oc:display-name/><oc:user-visible/><oc:user-assignable/></d:prop></d:propfind>',
  headers: { Depth: '1', 'Content-Type': 'application/xml' },
}));
