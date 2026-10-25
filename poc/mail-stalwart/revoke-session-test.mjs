import fs from 'node:fs';
import tls from 'node:tls';

const ready='/private/tmp/vcworkspace-mail08-revoke.ready',trigger='/private/tmp/vcworkspace-mail08-revoke.trigger';
for(const path of [ready,trigger])fs.rmSync(path,{force:true});
const email='nv.mkt@vcworkspace.test',pass=process.env.MAIL_TEST_B_PASSWORD;
if(!pass)throw new Error('Thiếu credential B thử');
const socket=tls.connect({host:'127.0.0.1',port:18993,servername:'mail.vcworkspace.test',rejectUnauthorized:false});let buffer='',closed=false;socket.on('data',d=>buffer+=d.toString('latin1'));const closedSignal=new Promise(ok=>socket.once('close',()=>{closed=true;ok('closed')}));
function wait(re,ms=15000){return new Promise((ok,no)=>{const check=()=>{if(re.test(buffer)){done();ok(buffer)}};const done=()=>{clearTimeout(timer);socket.off('data',check);socket.off('error',fail)};const fail=e=>{done();no(e)};const timer=setTimeout(()=>fail(new Error(`timeout ${re}: ${buffer.slice(-400)}`)),ms);socket.on('data',check);socket.on('error',fail);check()})}
await wait(/^\* OK/m);socket.write(`a1 LOGIN "${email}" "${pass}"\r\n`);await wait(/^a1 OK/m);socket.write('a2 SELECT "Shared Folders/mkt-team@vcworkspace.test/INBOX"\r\n');await wait(/^a2 OK/m);fs.writeFileSync(ready,'ready',{mode:0o600});
const started=Date.now();while(!fs.existsSync(trigger)&&Date.now()-started<30000)await new Promise(r=>setTimeout(r,100));if(!fs.existsSync(trigger))throw new Error('Không nhận trigger thu hồi');
if(closed||socket.destroyed){console.log(JSON.stringify({ok:true,oldSessionClosed:true,oldSessionFetchLeaked:false,oldSessionSearchLeaked:false}));process.exit(0);}
buffer='';socket.write('a3 FETCH 1:* BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]\r\n');const fetchResult=await Promise.race([wait(/^a3 (OK|NO|BAD)/m).then(()=> 'response'),closedSignal]);if(fetchResult==='closed'){const fetchLeaked=/^\* \d+ FETCH/m.test(buffer);const ok=!fetchLeaked;console.log(JSON.stringify({ok,oldSessionClosed:true,oldSessionFetchLeaked:fetchLeaked,oldSessionSearchLeaked:false}));if(!ok)process.exit(2);process.exit(0);}const fetchLeaked=/^\* \d+ FETCH/m.test(buffer),fetchAllowed=/^a3 OK/m.test(buffer);
buffer='';socket.write('a4 SEARCH ALL\r\n');await wait(/^a4 (OK|NO|BAD)/m);const searchLeaked=/^\* SEARCH\s+\d/m.test(buffer),searchAllowed=/^a4 OK/m.test(buffer);
buffer='';socket.write('a5 NOOP\r\n');await wait(/^a5 (OK|NO|BAD)/m);const noopAllowed=/^a5 OK/m.test(buffer);
buffer='';socket.write('a6 SELECT "Shared Folders/mkt-team@vcworkspace.test/INBOX"\r\n');await wait(/^a6 (OK|NO|BAD)/m);const reselectAllowed=/^a6 OK/m.test(buffer);socket.end();const ok=!fetchLeaked&&!searchLeaked&&!reselectAllowed;console.log(JSON.stringify({ok,oldSessionFetchAllowed:fetchAllowed,oldSessionFetchLeaked:fetchLeaked,oldSessionSearchAllowed:searchAllowed,oldSessionSearchLeaked:searchLeaked,oldSessionNoopAllowed:noopAllowed,oldSessionReselectDenied:!reselectAllowed}));if(!ok)process.exit(2);
