// Chat17: configure Talk on work13 for an isolated small-scale PoC (occ only).
//  - Internal signaling (no HPB / external signaling server), no TURN.
//  - No STUN: Talk falls back to stun.nextcloud.com:443 when the list is empty,
//    and the *browsers* (on the host, outside the internal Docker network) would
//    then contact it. Only has_internet_connection=false removes that fallback
//    (DOC lib/Config.php getStunServers). The work13 network has no route out
//    anyway, so this flag matches reality.
//  - force_passwords=yes: public (guest) conversations need a password; Talk has
//    no global switch to disable guests, any moderator can make a room public.
//  - Directory policy of chat13/16 stays as is (only share with group members,
//    enumeration restricted to group, no full-match lookups).
import { occ, occJson, writeEvidence } from './lib.mjs';

await occ('config:system:set', 'has_internet_connection', '--type=boolean', '--value=false');
await occ('config:app:set', 'spreed', 'stun_servers', '--value=[]');
await occ('config:app:set', 'spreed', 'turn_servers', '--value=[]');
await occ('config:app:set', 'spreed', 'signaling_servers', '--value={"servers":[],"secret":"","hideWarning":true}');
await occ('config:app:set', 'spreed', 'force_passwords', '--type=boolean', '--value=true');
await occ('config:app:set', 'spreed', 'call_recording', '--value=no');
await occ('config:app:set', 'spreed', 'sip_dialout', '--value=no');
await occ('config:app:set', 'spreed', 'federation_enabled', '--value=no');

const read = async (app, key) => (await occ('config:app:get', app, key).catch(() => ({ stdout: '(unset)' }))).stdout.trim();
const config = {
  system: { has_internet_connection: (await occ('config:system:get', 'has_internet_connection')).stdout.trim() },
  spreed: {},
  core: {},
};
for (const key of ['stun_servers', 'turn_servers', 'signaling_servers', 'force_passwords', 'call_recording', 'sip_dialout', 'federation_enabled', 'allowed_groups', 'start_conversations', 'default_attachment_folder', 'conversations_files', 'conversations_files_public_shares']) config.spreed[key] = await read('spreed', key);
for (const key of ['shareapi_only_share_with_group_members', 'shareapi_restrict_user_enumeration_to_group', 'shareapi_restrict_user_enumeration_full_match', 'shareapi_allow_share_dialog_user_enumeration', 'shareapi_allow_links', 'shareapi_allow_resharing']) config.core[key] = await read('core', key);
config.spreed.signaling_servers = config.spreed.signaling_servers.replace(/"secret":"[^"]*"/, '"secret":"(empty)"');
const stun = (await occ('talk:stun:list').catch((e) => ({ stdout: String(e.stderr) }))).stdout.trim();
const turn = (await occ('talk:turn:list').catch((e) => ({ stdout: String(e.stderr) }))).stdout.trim();
const signaling = (await occ('talk:signaling:list').catch((e) => ({ stdout: String(e.stderr) }))).stdout.trim();
const apps = await occJson('app:list');
await writeEvidence('nextcloud-config.json', { config, occLists: { stun, turn, signaling }, spreed: apps.enabled.spreed });
console.log(JSON.stringify(config, null, 1));
