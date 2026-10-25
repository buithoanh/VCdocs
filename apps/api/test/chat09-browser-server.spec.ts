import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { createTestApp, TestApp } from './support/app';

const enabled=process.env.RUN_CHAT09_BROWSER_SERVER==='1';
(enabled?describe:describe.skip)('Chat09 browser real engines server',()=>{
  let t:TestApp; const hold=Number(process.env.BROWSER_SMOKE_HOLD_MS||1200000);
  beforeAll(async()=>{
    const required=['POC_BASE_URL','POC_USER_A_VALUE','POC_USER_B_VALUE','MAIL_TEST_A_PASSWORD','MAIL_TEST_B_PASSWORD','STALWART_RECOVERY_ADMIN'];
    for(const name of required)if(!process.env[name])throw new Error(`Thiếu biến thử ${name}`);
    const recovery=process.env.STALWART_RECOVERY_ADMIN!,at=recovery.indexOf(':');if(at<1)throw new Error('Recovery credential thử không hợp lệ');
    t=await createTestApp({port:14000,publicApiOrigin:'http://127.0.0.1:14000',webOrigin:'http://127.0.0.1:13000',workspaceStorage:{mode:'nextcloud',baseUrl:process.env.POC_BASE_URL,timeoutMs:10000,credentials:{'tp.mkt@vcprosperous.com':{username:'vcw-poc-a',password:process.env.POC_USER_A_VALUE!},'nv.mkt@vcprosperous.com':{username:'vcw-poc-b',password:process.env.POC_USER_B_VALUE!}}},documentEditor:{enabled:true,publicOrigin:'http://127.0.0.1:18082',internalOrigin:'http://127.0.0.1:18082',apiOriginForEditor:'http://host.docker.internal:14000',jwtSecret:'vcworkspace-test-editor-secret'},mailEngine:{mode:'stalwart',host:'127.0.0.1',smtpPort:18465,imapPort:18993,sievePort:14190,controlPort:19090,controlToken:process.env.MAIL_TEST_A_PASSWORD!,credentials:{'tp.mkt@vcworkspace.test':{username:'tp.mkt@vcworkspace.test',password:process.env.MAIL_TEST_A_PASSWORD!},'nv.mkt@vcworkspace.test':{username:'nv.mkt@vcworkspace.test',password:process.env.MAIL_TEST_B_PASSWORD!}},management:{baseUrl:'http://127.0.0.1:18084',username:recovery.slice(0,at),password:recovery.slice(at+1)}}});
    await t.app.listen(14000,'127.0.0.1');
    const a=await t.login('tp.mkt'),b=await t.login('nv.mkt'),bytes=createDocumentTemplate('CHAT09 BODY V1'),sha256=createHash('sha256').update(bytes).digest('hex'),runId=`chat09-${Date.now()}`;
    const sent=await a.post('/mail/send',{to:['nv.mkt@vcworkspace.test'],subject:`CHAT09 REAL ${runId}`,text:'Attachment DOCX V1',attachments:[{filename:`chat09-${runId}.docx`,contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',contentBase64:bytes.toString('base64')}]},{idem:`${runId}-source`});
    const inbox=await b.get('/mail/messages?folder=inbox'),message=inbox.body.items.find((x:any)=>x.subject===`CHAT09 REAL ${runId}`);if(!message)throw new Error('Stalwart ACK nhưng B chưa sync được thư chat09');
    const department=(await a.get('/spaces')).body.items.find((x:any)=>x.kind==='department');await b.get('/spaces');
    const linkFile=await a.post('/drive/documents',{spaceId:department.id,name:`link-${runId}`},{idem:`${runId}-link-file`});
    const linkSubject=`CHAT09 LINK LOGIN ${runId}`;
    await a.post('/mail/send-drive-file',{to:['nv.mkt@vcworkspace.test'],subject:linkSubject,text:'Mở link qua đăng nhập',fileId:linkFile.body.id,versionId:linkFile.body.currentVersionId,expectedSha256:linkFile.body.contentSha256,mode:'link'},{idem:`${runId}-link-mail`});
    writeFileSync('/private/tmp/vcworkspace-chat09-browser.json',JSON.stringify({runId,messageId:message.id,sourceSha256:sha256,sentId:sent.body.id,markerV2:`CHAT09 BODY V2 ${runId}`,linkSubject,linkFileId:linkFile.body.id,linkSha256:linkFile.body.contentSha256}),{mode:0o600});
    console.log(`CHAT09_BROWSER_READY run=${runId} message=${message.id} sourceSha256=${sha256}`);
  },120000);
  afterAll(async()=>{if(t)await t.close();});
  it('holds real-engine API for browser',async()=>{await new Promise(resolve=>setTimeout(resolve,hold));},hold+10000);
});
