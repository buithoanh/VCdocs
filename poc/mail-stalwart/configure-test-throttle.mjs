const recovery=process.env.STALWART_RECOVERY_ADMIN??'',separator=recovery.indexOf(':');
if(separator<1)throw new Error('Thiếu recovery credential thử');
const base='http://127.0.0.1:18084',authorization=`Basic ${Buffer.from(recovery).toString('base64')}`;
const sessionResponse=await fetch(`${base}/jmap/session`,{headers:{Authorization:authorization}});
if(!sessionResponse.ok)throw new Error(`Session HTTP ${sessionResponse.status}`);
const session=await sessionResponse.json(),apiUrl=`${base}${new URL(session.apiUrl,base).pathname}`,using=Object.keys(session.capabilities);
const call=async(methodCalls)=>{const response=await fetch(apiUrl,{method:'POST',headers:{Authorization:authorization,'content-type':'application/json'},body:JSON.stringify({using,methodCalls})});if(!response.ok)throw new Error(`JMAP HTTP ${response.status}`);const json=await response.json();if(json.methodResponses?.some(x=>x[0]==='error'||x[1]?.notCreated||x[1]?.notUpdated))throw new Error(`JMAP rejected ${JSON.stringify(json.methodResponses).slice(0,800)}`);return json.methodResponses;};
const current=await call([['x:MtaInboundThrottle/query',{},'q'],['x:MtaInboundThrottle/get',{'#ids':{resultOf:'q',name:'x:MtaInboundThrottle/query',path:'/ids'}},'g']]);
const list=current.find(x=>x[0]==='x:MtaInboundThrottle/get')?.[1]?.list??[],baseRule=list.find(x=>x.description==='Sender address to recipient throttle'),testRule=list.find(x=>x.description==='VCworkspace local test identities');
if(!baseRule)throw new Error('Không tìm thấy throttle gốc');
const update={
  [baseRule.id]:{match:{match:{0:{if:"sender_domain == 'vcworkspace.test' && ends_with(rcpt, '@vcworkspace.test')",then:'false'}},else:'true'}},
};
if(testRule)update[testRule.id]={enable:true,key:{authenticatedAs:true,rcpt:true},match:{else:"sender_domain == 'vcworkspace.test' && ends_with(rcpt, '@vcworkspace.test')"},rate:{count:200,period:3600000}};
const args={update};
if(!testRule)args.create={localTest:{enable:true,description:'VCworkspace local test identities',key:{authenticatedAs:true,rcpt:true},match:{else:"sender_domain == 'vcworkspace.test' && ends_with(rcpt, '@vcworkspace.test')"},rate:{count:200,period:3600000}}};
await call([['x:MtaInboundThrottle/set',args,'s']]);
const verified=await call([['x:MtaInboundThrottle/query',{},'q'],['x:MtaInboundThrottle/get',{'#ids':{resultOf:'q',name:'x:MtaInboundThrottle/query',path:'/ids'}},'g']]),rows=verified.find(x=>x[0]==='x:MtaInboundThrottle/get')?.[1]?.list??[];
const scoped=rows.find(x=>x.description==='VCworkspace local test identities'),global=rows.find(x=>x.description==='Sender address to recipient throttle');
if(scoped?.rate?.count!==200||scoped?.key?.authenticatedAs!==true||!String(global?.match?.match?.[0]?.if??'').includes('vcworkspace.test'))throw new Error('Throttle readback không đạt');
console.log(JSON.stringify({ok:true,baseRuleScopedAwayFromLocalTest:true,testRule:{description:scoped.description,key:scoped.key,rate:scoped.rate,match:scoped.match}}));
