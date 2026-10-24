import { StalwartMailPort } from '../../apps/api/dist/modules/mail-basic/stalwart-mail.port.js';

const recovery=process.env.STALWART_RECOVERY_ADMIN??'',at=recovery.indexOf(':');
const auth=`Basic ${Buffer.from(recovery).toString('base64')}`;
try{const response=await fetch('http://127.0.0.1:18084/jmap/session',{headers:{Authorization:auth}}),session=await response.json();console.log(`session:${response.status}:${session.apiUrl}`);}catch(error){console.log(`session:failed:${error instanceof Error?`${error.message}:${error.cause?.code??''}`:'unknown'}`);}
const port=new StalwartMailPort({host:'127.0.0.1',smtpPort:18465,imapPort:18993,sievePort:14190,credentials:{
  'tp.mkt@vcworkspace.test':{username:'tp.mkt@vcworkspace.test',password:process.env.MAIL_TEST_A_PASSWORD},
  'nv.mkt@vcworkspace.test':{username:'nv.mkt@vcworkspace.test',password:process.env.MAIL_TEST_B_PASSWORD},
},management:{baseUrl:'http://127.0.0.1:18084',username:recovery.slice(0,at),password:recovery.slice(at+1)}});
for(const [name,fn] of [
  ['sieve-create',()=>port.installFilters('nv.mkt@vcworkspace.test',[{field:'subject',operator:'contains',value:'báo cáo quý',addLabels:['Khẩn'],moveToFolder:'vip',stop:true}])],
  ['sieve-update',()=>port.installFilters('nv.mkt@vcworkspace.test',[{field:'subject',operator:'contains',value:'báo cáo quý',addLabels:['Khẩn','Khách hàng'],moveToFolder:'vip',stop:true}])],
  ['alias',()=>port.provisionAlias('tp.mkt@vcworkspace.test','marketing@vcworkspace.test')],
  ['shared',()=>port.provisionShared('mkt-team@vcworkspace.test')],
  ...(process.env.MAIL_DIAG_MESSAGE_ID?[['labels',()=>port.setLabels('nv.mkt@vcworkspace.test',process.env.MAIL_DIAG_MESSAGE_ID,['Khẩn'],['Khẩn','Khách hàng'],'vip')]]:[]),
]){try{await fn();console.log(`${name}:ok`);}catch(error){console.log(`${name}:failed:${error instanceof Error?error.message:'unknown'}`);}}
