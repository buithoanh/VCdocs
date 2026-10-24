import tls from 'node:tls';

const email='nv.mkt@vcworkspace.test',password=process.env.MAIL_TEST_B_PASSWORD;
if(!password)throw new Error('Thiếu credential thử');
let buffer='';
const socket=tls.connect({host:'127.0.0.1',port:18993,servername:'mail.vcworkspace.test',rejectUnauthorized:false});
socket.on('data',chunk=>buffer+=chunk.toString('latin1'));
const read=(pattern,timeout=10000)=>new Promise((resolve,reject)=>{const check=()=>{if(!pattern.test(buffer))return;cleanup();resolve(buffer);};const cleanup=()=>{clearTimeout(timer);socket.off('data',check);};const timer=setTimeout(()=>{cleanup();reject(new Error(`timeout ${pattern}: ${buffer.slice(-500)}`));},timeout);socket.on('data',check);check();});
await read(/^\* OK/m);buffer='';socket.write(`a1 LOGIN "${email}" "${password}"\r\n`);await read(/^a1 OK/m);
buffer='';socket.write('a2 LIST "" "*"\r\n');const listed=await read(/^a2 OK/m);
const folders=[...listed.matchAll(/^\* LIST .* "([^"]+)"\r?$/gm)].map(x=>x[1]).filter(x=>/mkt-team/i.test(x));
const results=[];
for(const folder of folders){buffer='';socket.write(`a3 SELECT "${folder}"\r\n`);const response=await read(/^a3 (?:OK|NO|BAD)/m);const result={folder,selected:/^a3 OK/m.test(response),tail:response.split(/\r?\n/).slice(-3)};if(folder.endsWith('/INBOX')&&result.selected){buffer='';socket.write('a4 FETCH 1:* BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]\r\n');const fetched=await read(/^a4 OK/m);result.messageIds=[...fetched.matchAll(/Message-ID:\s*<([^>]+)>/gi)].map(x=>x[1]);}results.push(result);}
socket.end();console.log(JSON.stringify({folders,results}));
