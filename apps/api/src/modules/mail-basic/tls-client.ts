import tls from 'tls';
export async function tlsConnect(host:string,port:number){
  if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('MAIL_EGRESS_BLOCKED');
  const socket=tls.connect({host,port,servername:'mail.vcworkspace.test',rejectUnauthorized:false});let buffer='',cursor=0;
  socket.on('data',d=>{buffer+=d.toString('latin1');});
  await new Promise<void>((ok,no)=>{socket.once('secureConnect',ok);socket.once('error',no)});
  return {read:(re:RegExp,timeoutMs=10000)=>new Promise<string>((ok,no)=>{const start=cursor;const check=()=>{const part=buffer.slice(start),match=re.exec(part);if(!match)return;cleanup();cursor=start+match.index+match[0].length;ok(part.slice(0,match.index+match[0].length));};const fail=(error:Error)=>{cleanup();no(error);};const cleanup=()=>{clearTimeout(timer);socket.off('data',check);socket.off('error',fail);};const timer=setTimeout(()=>fail(new Error(`MAIL_PROTOCOL_TIMEOUT:${re.source}`)),timeoutMs);socket.on('data',check);socket.on('error',fail);check();}),write:(x:string|Buffer)=>socket.write(x),end:()=>socket.end()};
}
