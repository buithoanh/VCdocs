const recovery=process.env.STALWART_RECOVERY_ADMIN??'',separator=recovery.indexOf(':');
if(separator<1)throw new Error('Thiếu recovery credential thử');
const base='http://127.0.0.1:18084',authorization=`Basic ${Buffer.from(recovery).toString('base64')}`;
const sessionResponse=await fetch(`${base}/jmap/session`,{headers:{Authorization:authorization}});
if(!sessionResponse.ok)throw new Error(`Session HTTP ${sessionResponse.status}`);
const session=await sessionResponse.json(),apiUrl=`${base}${new URL(session.apiUrl,base).pathname}`;
const calls=[
  ['x:MtaInboundThrottle/query',{},'iq'],
  ['x:MtaInboundThrottle/get',{'#ids':{resultOf:'iq',name:'x:MtaInboundThrottle/query',path:'/ids'}},'ig'],
  ['x:MtaStageRcpt/get',{},'rg'],
  ['x:MtaStageMail/get',{},'mg'],
];
const response=await fetch(apiUrl,{method:'POST',headers:{Authorization:authorization,'content-type':'application/json'},body:JSON.stringify({using:Object.keys(session.capabilities),methodCalls:calls})});
if(!response.ok)throw new Error(`JMAP HTTP ${response.status}`);
const json=await response.json();
console.log(JSON.stringify({methodResponses:json.methodResponses},null,2));
