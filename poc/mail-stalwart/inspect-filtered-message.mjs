import tls from 'node:tls';

const email='nv.mkt@vcworkspace.test',password=process.env.MAIL_TEST_B_PASSWORD;
if(!password)throw new Error('Thiếu credential thử');
const socket=tls.connect({host:'127.0.0.1',port:18993,servername:'mail.vcworkspace.test',rejectUnauthorized:false});
let buffer='',cursor=0;socket.on('data',chunk=>buffer+=chunk.toString('latin1'));
const read=(target)=>new Promise((resolve,reject)=>{const start=cursor,check=()=>{const part=buffer.slice(start),match=target.exec(part);if(!match)return;cleanup();cursor=start+match.index+match[0].length;resolve(part.slice(0,match.index+match[0].length));},fail=error=>{cleanup();reject(error);},cleanup=()=>{clearTimeout(timer);socket.off('data',check);socket.off('error',fail);},timer=setTimeout(()=>fail(new Error('timeout')),10000);socket.on('data',check);socket.on('error',fail);check();});
await read(/^\* OK/m);socket.write(`a1 LOGIN "${email}" "${password}"\r\n`);await read(/^a1 OK/m);
socket.write('a2 LIST "" "*"\r\n');const listed=await read(/^a2 OK/m);
const names=[...listed.matchAll(/^\* LIST .* "([^"]+)"\r?$/gm)].map(match=>match[1]);
const hits=[];
for(const [index,name] of names.entries()){
  const tag=`b${index}`;socket.write(`${tag} SELECT "${name}"\r\n`);const selected=await read(new RegExp(`^${tag} (?:OK|NO)`,'m'));if(!new RegExp(`^${tag} OK`,'m').test(selected))continue;
  const searchTag=`c${index}`;socket.write(`${searchTag} SEARCH HEADER Subject "Báo cáo quý Alpha"\r\n`);const found=await read(new RegExp(`^${searchTag} OK`,'m')),ids=[...found.matchAll(/\* SEARCH ([0-9 ]*)/g)].at(-1)?.[1]?.trim();if(ids){const sequence=ids.split(' ').pop(),fetchTag=`d${index}`;socket.write(`${fetchTag} FETCH ${sequence} (FLAGS BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])\r\n`);const fetched=await read(new RegExp(`^${fetchTag} OK`,'m')),messageId=fetched.match(/Message-ID:\s*<([^>]+)>/i)?.[1],flags=fetched.match(/FLAGS \(([^)]*)\)/i)?.[1]??'';let searchById='',searchText='';if(messageId){const idTag=`e${index}`;socket.write(`${idTag} SEARCH HEADER Message-ID "<${messageId}>"\r\n`);const byId=await read(new RegExp(`^${idTag} OK`,'m'));searchById=[...byId.matchAll(/\* SEARCH ([0-9 ]*)/g)].at(-1)?.[1]?.trim()??'';const textTag=`f${index}`;socket.write(`${textTag} SEARCH TEXT "${messageId}"\r\n`);const byText=await read(new RegExp(`^${textTag} OK`,'m'));searchText=[...byText.matchAll(/\* SEARCH ([0-9 ]*)/g)].at(-1)?.[1]?.trim()??'';}hits.push({name,ids,messageId,flags,searchById,searchText});}
}
socket.write('z1 LOGOUT\r\n');socket.end();console.log(JSON.stringify({ok:true,names,hits}));
