// Chat17: functional checks on the restore stack (127.0.0.1:18173) after
// verify-state compare + verify-acl restore: chat round trip, a file shared
// into Team A still readable by the member and not by Team B, Talk config
// (no STUN/TURN, force_passwords) restored. Run with the restore env
// (TALK17_NC_BASE, CAL16_NC_CONTAINER, CAL16_RELAY_CONTAINER, CAL16_RELAY_NETWORK).
import { assert, client, ocsData, readEvidence, resetBruteforce, talk, writeEvidence } from './lib.mjs';

if (!(process.env.TALK17_NC_BASE ?? '').includes('18173')) throw new Error('RUN_AGAINST_RESTORE_ONLY');
await resetBruteforce();
const conv = await readEvidence('conversations.json');
const member = await client('member-a');
const owner = await client('successor-a');
const managerB = await client('manager-b');
const post = await member.request('POST', talk.chat(conv.teamA.token), { json: { message: `tren ban restore ${Date.now().toString(36)}` } });
const seen = (ocsData(await owner.request('GET', `${talk.chat(conv.teamA.token)}?lookIntoFuture=0&limit=5&setReadMarker=0`)) ?? []).some((m) => m.id === ocsData(post)?.id);
const shares = ocsData(await member.request('GET', '/ocs/v2.php/apps/files_sharing/api/v1/shares?shared_with_me=true')) ?? [];
const roomShare = shares.find((s) => s.share_type === 10 && s.share_with === conv.teamA.token);
const fileRead = roomShare ? (await member.request('GET', `/remote.php/dav/files/${member.uid}${roomShare.path.split('/').map(encodeURIComponent).join('/')}`)).status : 'no-share';
const teamBShares = (ocsData(await managerB.request('GET', '/ocs/v2.php/apps/files_sharing/api/v1/shares?shared_with_me=true')) ?? []).filter((s) => s.share_with === conv.teamA.token).length;
const caps = ocsData(await member.request('GET', '/ocs/v2.php/cloud/capabilities'))?.capabilities?.spreed;
const settings = ocsData(await member.request('GET', talk.signaling(`/settings?token=${conv.teamA.token}`)));
const result = { postStatus: post.status, ownerSeesPost: seen, memberRoomShares: shares.filter((s) => s.share_type === 10).length, memberReadsRoomFile: fileRead, teamBSeesTeamARoomShares: teamBShares, forcePasswords: caps?.config?.conversations?.['force-passwords'], stun: settings?.stunservers, turn: settings?.turnservers?.length ?? 0 };
await writeEvidence('verify-restore.json', result);
console.log(JSON.stringify(result));
assert(post.status === 201 && seen && fileRead === 200 && teamBShares === 0 && result.forcePasswords === true && (result.stun ?? []).length === 0, 'restore functional', result);
