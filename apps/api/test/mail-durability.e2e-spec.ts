import { createTestApp, TestApp } from './support/app';
import { FakeMailPort, MAIL_PORT } from '../src/modules/mail-basic/mail.port';
import { MailBasicService } from '../src/modules/mail-basic/mail-basic.service';

describe('Email durability và đa tiến trình',()=>{
  let t:TestApp;let fake:FakeMailPort;
  beforeAll(async()=>{t=await createTestApp();fake=t.app.get(MAIL_PORT) as FakeMailPort;});
  afterAll(()=>t.close());

  it('reconcile cùng Message-ID sau lỗi đúng thời điểm mail engine đã ACK',async()=>{
    const a=await t.login('tp.mkt');fake.sentVisibilityDelayOnce=5;fake.failAfterDeliveryAckOnce=true;const before=fake.deliveryCount;
    const input={to:['nv.mkt@vcworkspace.test'],subject:'Durable ACK',text:'không gửi trùng'};
    expect((await a.post('/mail/send',input,{idem:'durable-after-ack-08'})).status).toBe(503);
    expect((await a.post('/mail/send',input,{idem:'durable-after-ack-08'})).status).toBe(503);
    const retried=await a.post('/mail/send',input,{idem:'durable-after-ack-08'});
    expect(retried.status).toBe(201);expect(fake.deliveryCount-before).toBe(1);
    const attempt=await t.db.m.WorkspaceMailSend.findOne({companyId:t.ids.companyId,idempotencyKey:'durable-after-ack-08'}).lean<any>();
    expect(attempt).toMatchObject({state:'sent'});expect(attempt.internetMessageId).toMatch(/@vcworkspace\.test$/);
    expect(await t.db.m.WorkspaceMailMessage.countDocuments({companyId:t.ids.companyId,mailboxOwner:'tp.mkt@vcworkspace.test',internetMessageId:attempt.internetMessageId})).toBe(1);
  });

  it('lỗi typed chắc chắn pre-ACK cho phép retry gửi đúng một lần thành công',async()=>{
    const a=await t.login('tp.mkt');fake.failBeforeDeliveryAckOnce=true;const before=fake.deliveryCount,input={to:['nv.mkt@vcworkspace.test'],subject:'Pre ACK retry',text:'được phép gửi lại'};
    expect((await a.post('/mail/send',input,{idem:'typed-pre-ack-08'})).status).toBe(503);
    expect((await t.db.m.WorkspaceMailSend.findOne({companyId:t.ids.companyId,idempotencyKey:'typed-pre-ack-08'}).lean<any>())).toMatchObject({state:'failed',errorCode:'PRE_ACK_RETRYABLE'});
    expect((await a.post('/mail/send',input,{idem:'typed-pre-ack-08'})).status).toBe(201);expect(fake.deliveryCount-before).toBe(1);
  });

  it('CAS chỉ cho một concurrent retry của lỗi pre-ACK đi vào delivery',async()=>{
    const a=await t.login('tp.mkt');fake.failBeforeDeliveryAckOnce=true;const input={to:['nv.mkt@vcworkspace.test'],subject:'Concurrent pre ACK',text:'single winner'};
    expect((await a.post('/mail/send',input,{idem:'concurrent-pre-ack-08'})).status).toBe(503);
    const before=fake.deliveryCount;let entered!:()=>void,release!:()=>void;const enteredP=new Promise<void>(r=>entered=r),releaseP=new Promise<void>(r=>release=r);
    fake.beforeDeliveryHook=async()=>{fake.beforeDeliveryHook=undefined;entered();await releaseP;};
    const first=a.post('/mail/send',input,{idem:'concurrent-pre-ack-08'});await enteredP;
    const second=a.post('/mail/send',input,{idem:'concurrent-pre-ack-08'});const secondResult=await second;release();const firstResult=await first;
    expect([firstResult.status,secondResult.status].sort()).toEqual([201,409]);
    expect(fake.deliveryCount-before).toBe(1);
    expect(await t.db.m.WorkspaceMailMessage.countDocuments({companyId:t.ids.companyId,mailboxOwner:'tp.mkt@vcworkspace.test',subject:'Concurrent pre ACK'})).toBe(1);
  });

  it('CAS Mongo chặn hai process cùng ghi filter và journal revision đã áp',async()=>{
    const b=await t.login('nv.mkt');await b.post('/mail/labels',{name:'CAS08',color:'#123456'},{idem:'cas-label-08'});
    let entered!:()=>void,release!:()=>void;const enteredP=new Promise<void>(r=>entered=r),releaseP=new Promise<void>(r=>release=r);
    fake.filterInstallHook=async()=>{fake.filterInstallHook=undefined;entered();await releaseP;};
    const firstP=b.post('/mail/filters',{name:'CAS một',field:'subject',operator:'contains',value:'một',addLabels:['CAS08'],enabled:true},{idem:'cas-filter-1-08'});
    await enteredP;
    const second=await b.post('/mail/filters',{name:'CAS hai',field:'subject',operator:'contains',value:'hai',addLabels:['CAS08'],enabled:true},{idem:'cas-filter-2-08'});
    expect(second.status).toBe(409);release();expect((await firstP).status).toBe(201);
    const journal=await t.db.m.WorkspaceMailFilterState.findOne({companyId:t.ids.companyId,ownerEmail:'nv.mkt@vcworkspace.test'}).lean<any>();
    expect(journal).toMatchObject({status:'applied',revision:1,appliedRevision:1});expect(journal.leaseToken).toBeUndefined();
    expect(fake.installedFilters.map(x=>x.value)).toContain('một');
  });

  it('journal ghi rõ reconcile required nếu cả apply và rollback filter đều lỗi',async()=>{
    const a=await t.login('tp.mkt');await a.post('/mail/labels',{name:'Rollback08',color:'#654321'},{idem:'rollback-label-08'});
    fake.filterInstallHook=async()=>{throw new Error('ENGINE_FILTER_DOWN');};
    const response=await a.agent.post('/api/v1/mail/filters').set('X-CSRF-Token',a.csrf).set('Idempotency-Key','rollback-filter-08').send({name:'Rollback lỗi',field:'subject',operator:'contains',value:'rollback',addLabels:['Rollback08'],enabled:true});
    fake.filterInstallHook=undefined;expect(response.status).toBe(503);
    const journal=await t.db.m.WorkspaceMailFilterState.findOne({companyId:t.ids.companyId,ownerEmail:'tp.mkt@vcworkspace.test'}).lean<any>();
    expect(journal).toMatchObject({status:'failed',lastError:'FILTER_ROLLBACK_FAILED_RECONCILE_REQUIRED'});
    expect(await t.db.m.WorkspaceMailFilter.countDocuments({companyId:t.ids.companyId,ownerEmail:'tp.mkt@vcworkspace.test',name:'Rollback lỗi'})).toBe(0);
  });

  it('fence writer hết lease, không cho claim success và phục hồi revision mới',async()=>{
    const user=await t.db.m.User.findOne({_id:t.ids.users['nv.mkt'],companyId:t.ids.companyId}).lean<any>(),ctx=()=>({companyId:String(t.ids.companyId),user:{id:String(user._id),email:user.email,name:user.name,systemRoles:user.systemRoles},requestId:'fence',ip:'test',device:'test',driveRoles:new Map(),visibleDriveIds:[],query:{},auditIds:[]} as any),service=t.app.get(MailBasicService);
    let entered!:()=>void,release!:()=>void;const enteredP=new Promise<void>(r=>entered=r),releaseP=new Promise<void>(r=>release=r);
    fake.filterInstallHook=async()=>{fake.filterInstallHook=undefined;entered();await releaseP;};
    const firstP=service.createFilter(ctx(),{name:'Fence A',field:'subject',operator:'contains',value:'fence-a',addLabels:['CAS08'],enabled:true});
    await enteredP;await t.db.m.WorkspaceMailFilterState.updateOne({companyId:t.ids.companyId,ownerEmail:'nv.mkt@vcworkspace.test'},{$set:{leaseUntil:new Date(0)}});
    const second=await service.createFilter(ctx(),{name:'Fence B',field:'subject',operator:'contains',value:'fence-b',addLabels:['CAS08'],enabled:true});
    expect(second.value).toBe('fence-b');release();await expect(firstP).rejects.toMatchObject({code:'STATE_INVALID'});
    const journal=await t.db.m.WorkspaceMailFilterState.findOne({companyId:t.ids.companyId,ownerEmail:'nv.mkt@vcworkspace.test'}).lean<any>();
    expect(journal).toMatchObject({status:'applied',revision:3,appliedRevision:3});
    expect(fake.installedFilters.map(x=>x.value)).toContain('fence-b');expect(fake.installedFilters.map(x=>x.value)).not.toContain('fence-a');
    expect(await t.db.m.WorkspaceMailFilter.countDocuments({companyId:t.ids.companyId,ownerEmail:'nv.mkt@vcworkspace.test',value:'fence-a',publishStatus:'active'})).toBe(0);
    await service.createFilter(ctx(),{name:'Fence A',field:'subject',operator:'contains',value:'fence-a',addLabels:['CAS08'],enabled:true});
    expect(await t.db.m.WorkspaceMailFilter.countDocuments({companyId:t.ids.companyId,ownerEmail:'nv.mkt@vcworkspace.test',value:'fence-a',publishStatus:'active'})).toBe(1);
  });

  it('mailparser đọc folded encoded header, quoted-printable và multipart lồng',async()=>{
    const subject=`=?UTF-8?B?${Buffer.from('Báo cáo ').toString('base64')}?=\r\n =?UTF-8?B?${Buffer.from('MIME').toString('base64')}?=`;
    const raw=Buffer.from(['From: "Người gửi" <tp.mkt@vcworkspace.test>','To: nv.mkt@vcworkspace.test',`Subject: ${subject}`,'Message-ID: <mime-maintained-08@vcworkspace.test>','Date: Fri, 24 Oct 2026 08:00:00 +0700','MIME-Version: 1.0','Content-Type: multipart/alternative; boundary="outer08"','','--outer08','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: quoted-printable','','N=E1=BB=99i dung kim-c=C6=B0=C6=A1ng-08','--outer08','Content-Type: text/html; charset=utf-8','','<b>Nội dung HTML</b>','--outer08--',''].join('\r\n'));
    fake.inject('nv.mkt@vcworkspace.test','inbox',raw,'mime-maintained-engine-08');
    const b=await t.login('nv.mkt');const result=await b.get('/mail/messages?folder=inbox&q=kim-c%C6%B0%C6%A1ng-08&scope=body');
    expect(result.body.items).toHaveLength(1);expect(result.body.items[0].subject).toBe('Báo cáo MIME');
  });

  it('audit 12/12: một thư engine thiếu Message-ID không làm cả danh sách trả 500',async()=>{
    fake.inject('nv.mkt@vcworkspace.test','inbox',Buffer.from(['From: tp.mkt@vcworkspace.test','To: nv.mkt@vcworkspace.test','Subject: Thiếu Message-ID 12','','Message-ID: <chi-trong-than-thu@vcworkspace.test>',''].join('\r\n')),'no-message-id-engine-12');
    fake.inject('nv.mkt@vcworkspace.test','inbox',Buffer.from(['From: tp.mkt@vcworkspace.test','To: nv.mkt@vcworkspace.test','Subject: Có Message-ID 12','Message-ID: <co-message-id-12@vcworkspace.test>','','x',''].join('\r\n')),'with-message-id-engine-12');
    const b=await t.login('nv.mkt');const result=await b.get('/mail/messages?folder=inbox&q=message-id%2012&scope=subject');
    expect(result.status).toBe(200);expect(result.body.items.map((x:any)=>x.subject)).toEqual(['Có Message-ID 12']);
  });
});
