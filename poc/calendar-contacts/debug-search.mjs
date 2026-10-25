// Chat16 debug: raw responses of the directory endpoints the web UI uses.
// `node debug-search.mjs <persona> <term>`
import { client } from './lib.mjs';

const [persona, term] = process.argv.slice(2);
const actor = await client(persona);
const enc = encodeURIComponent(term);
const show = (name, r) => console.log(name, r.status, (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)).slice(0, 700));
show('autocomplete', await actor.request('GET', `/ocs/v2.php/core/autocomplete/get?search=${enc}&itemType=%20&itemId=%20&shareTypes[]=0&limit=20&format=json`, { headers: { Accept: 'application/json' } }));
show('sharees', await actor.request('GET', `/ocs/v2.php/apps/files_sharing/api/v1/sharees?search=${enc}&itemType=file&shareType[]=0&perPage=20&format=json`, { headers: { Accept: 'application/json' } }));
show('unified', await actor.request('GET', `/ocs/v2.php/search/providers/contacts/search?term=${enc}&limit=20&format=json`, { headers: { Accept: 'application/json' } }));
show('menu', await actor.request('POST', '/index.php/contactsmenu/contacts', { json: { filter: term } }));
show('attendee', await actor.request('POST', '/index.php/apps/calendar/v1/autocompletion/attendee', { json: { search: term } }));
