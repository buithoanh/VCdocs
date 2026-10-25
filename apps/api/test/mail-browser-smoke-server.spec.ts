import { createTestApp, TestApp } from './support/app';
const enabled=process.env.RUN_MAIL_BROWSER_SMOKE==='1'; const suite=enabled?describe:describe.skip;
suite('Mail browser smoke server',()=>{let t:TestApp;const hold=Number(process.env.BROWSER_SMOKE_HOLD_MS||600000);
  beforeAll(async()=>{const a=process.env.MAIL_TEST_A_PASSWORD,b=process.env.MAIL_TEST_B_PASSWORD,recovery=process.env.STALWART_RECOVERY_ADMIN??'',at=recovery.indexOf(':');if(!a||!b||at<1)throw new Error('Thiếu credential mail thử');
    t=await createTestApp({port:14000,publicApiOrigin:'http://127.0.0.1:14000',webOrigin:'http://127.0.0.1:13000',mailEngine:{mode:'stalwart',host:'127.0.0.1',smtpPort:18465,imapPort:18993,sievePort:14190,controlPort:19090,controlToken:a,credentials:{'tp.mkt@vcworkspace.test':{username:'tp.mkt@vcworkspace.test',password:a},'nv.mkt@vcworkspace.test':{username:'nv.mkt@vcworkspace.test',password:b}},management:{baseUrl:'http://127.0.0.1:18084',username:recovery.slice(0,at),password:recovery.slice(at+1)}}});await t.app.listen(14000,'127.0.0.1');console.log('VCworkspace mail browser ready http://127.0.0.1:14000');});
  afterAll(()=>t?.close());it('keeps server available',()=>new Promise<void>(r=>setTimeout(r,hold)),hold+30000);
});
