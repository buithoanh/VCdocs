// Unified search: each app's marker must be found by Team A personas and never
// by Team B / outsider, across every search provider Nextcloud exposes.
import { client, ocsData, occ, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';

await resetBruteforce();
// Collectives page content search uses its own index; build it first.
await occ('collectives:index');
const markers = {
  deck: (await readEvidence('acceptance-deck.json')).marker,
  notes: (await readEvidence('acceptance-notes.json')).marker,
  forms: (await readEvidence('acceptance-forms.json')).marker,
  tables: (await readEvidence('acceptance-tables.json')).marker,
  collectives: (await readEvidence('acceptance-collectives.json')).marker,
};
const actors = await Promise.all(['manager-a', 'member-a', 'manager-b', 'outsider'].map(client));
const providers = ocsData(await actors[0].request('GET', '/ocs/v2.php/search/providers?format=json')).map((item) => item.id);

const matrix = {};
for (const actor of actors) {
  matrix[actor.username] = {};
  for (const [app, marker] of Object.entries(markers)) {
    const hits = [];
    for (const provider of providers) {
      const response = await actor.request('GET', `/ocs/v2.php/search/providers/${encodeURIComponent(provider)}/search?term=${encodeURIComponent(marker)}&limit=10&format=json`);
      const entries = ocsData(response)?.entries ?? [];
      if (entries.length) hits.push(`${provider}:${entries.length}`);
    }
    matrix[actor.username][app] = hits;
  }
}
const leaks = ['manager-b', 'outsider'].flatMap((name) => Object.entries(matrix[name]).filter(([, hits]) => hits.length).map(([app, hits]) => `${name}:${app}:${hits.join('|')}`));
if (leaks.length) throw new Error(`SEARCH_LEAK:${leaks.join(',')}`);
const coverage = Object.fromEntries(Object.keys(markers).map((app) => [app, {
  owner: matrix['manager-a'][app].length > 0,
  member: matrix['member-a'][app].length > 0,
}]));
await writeEvidence('acceptance-search.json', {
  providers,
  matrix,
  coverage,
  denyLeaks: leaks,
  result: 'LOCAL PASS for no cross-team leak; coverage per app is reported, not assumed',
});
console.log(`Search: providers ${providers.join(',')}\ncoverage ${JSON.stringify(coverage)}\nmatrix ${JSON.stringify(matrix)}`);
