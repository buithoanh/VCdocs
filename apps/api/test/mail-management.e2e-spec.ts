import { createTestApp, TestApp } from './support/app';
import * as tls from 'tls';
function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body?: Buffer) => void) { const chunks: Buffer[]=[]; res.on('data',(c)=>chunks.push(Buffer.from(c))); res.on('end',()=>done(null,Buffer.concat(chunks))); res.on('error',done); }
async function sharedFolderVisible(email:string,password:string,address:string){const socket=tls.connect({host:'127.0.0.1',port:18993,servername:'mail.vcworkspace.test',rejectUnauthorized:false});let buffer='';socket.on('data',chunk=>buffer+=chunk.toString('latin1'));const read=(pattern:RegExp)=>new Promise<string>((resolve,reject)=>{const check=()=>{if(!pattern.test(buffer))return;cleanup();resolve(buffer);},cleanup=()=>{clearTimeout(timer);socket.off('data',check);},timer=setTimeout(()=>{cleanup();reject(new Error('IMAP_TIMEOUT'));},5000);socket.on('data',check);check();});await read(/^\* OK/m);buffer='';socket.write(`a1 LOGIN "${email}" "${password}"\r\n`);await read(/^a1 OK/m);buffer='';socket.write('a2 LIST "" "*"\r\n');const list=await read(/^a2 OK/m);socket.end();return list.includes(`Shared Folders/${address}/INBOX`);}
async function smtpOutsideApi(password:string){const socket=tls.connect({host:'127.0.0.1',port:18465,servername:'mail.vcworkspace.test',rejectUnauthorized:false});let buffer='';socket.on('data',chunk=>buffer+=chunk.toString('latin1'));const read=(pattern:RegExp)=>new Promise<void>((resolve,reject)=>{const check=()=>{if(!pattern.test(buffer))return;done();resolve();},done=()=>{clearTimeout(timer);socket.off('data',check);socket.off('error',fail);},fail=(e:Error)=>{done();reject(e);},timer=setTimeout(()=>fail(new Error(`SMTP_TIMEOUT:${pattern}`)),30000);socket.on('data',check);socket.on('error',fail);check();});await read(/^220/m);buffer='';socket.write('EHLO vcworkspace.test\r\n');await read(/250[ -].*AUTH.*PLAIN/im);buffer='';socket.write(`AUTH PLAIN ${Buffer.from(`\0tp.mkt@vcworkspace.test\0${password}`).toString('base64')}\r\n`);await read(/^235/m);for(const command of ['MAIL FROM:<tp.mkt@vcworkspace.test>','RCPT TO:<nv.mkt@vcworkspace.test>']){buffer='';socket.write(`${command}\r\n`);await read(/^250/m);}buffer='';socket.write('DATA\r\n');await read(/^354/m);buffer='';socket.write(`From: tp.mkt@vcworkspace.test\r\nTo: nv.mkt@vcworkspace.test\r\nSubject: Báo cáo quý Ngoài API\r\nMessage-ID: <outside-api-${Date.now()}@vcworkspace.test>\r\nDate: ${new Date().toUTCString()}\r\n\r\nexternal-smtp-08\r\n.\r\n`);await read(/^250/m);socket.end();}

describe('Quản lý Email VCworkspace', () => {
  let t: TestApp;
  const runTag=`run-${Date.now()}`;
  beforeAll(async () => {
    if (process.env.RUN_MAIL_ENGINE_MANAGEMENT === '1') {
      const a=process.env.MAIL_TEST_A_PASSWORD,b=process.env.MAIL_TEST_B_PASSWORD,recovery=process.env.STALWART_RECOVERY_ADMIN??'',at=recovery.indexOf(':');
      if(!a||!b||at<1)throw new Error('Thiếu credential mail thử');
      t=await createTestApp({mailEngine:{mode:'stalwart',host:'127.0.0.1',smtpPort:18465,imapPort:18993,sievePort:14190,controlPort:19090,controlToken:a,credentials:{'tp.mkt@vcworkspace.test':{username:'tp.mkt@vcworkspace.test',password:a},'nv.mkt@vcworkspace.test':{username:'nv.mkt@vcworkspace.test',password:b}},management:{baseUrl:'http://127.0.0.1:18084',username:recovery.slice(0,at),password:recovery.slice(at+1)}}});
    } else t = await createTestApp();
  });
  afterAll(() => t.close());

  it('lưu nhiều nhãn, tìm đúng from/subject/body và áp bộ lọc thư đến', async () => {
    const a = await t.login('tp.mkt'); const b = await t.login('nv.mkt');
    const urgent = await b.post('/mail/labels', { name: 'Khẩn', color: '#FF0000' }, { idem: 'label-urgent-08' });
    const customer = await b.post('/mail/labels', { name: 'Khách hàng', color: '#0055AA' }, { idem: 'label-customer-08' });
    expect(urgent.status).toBe(201); expect(customer.status).toBe(201);
    expect((await b.get('/mail/labels')).body.items.map((x: any) => x.name)).toEqual(['Khách hàng', 'Khẩn']);

    const filter = await b.post('/mail/filters', { name: 'Báo cáo vào VIP', field: 'subject', operator: 'contains', value: 'báo cáo quý', addLabels: ['Khẩn'], moveToFolder: 'vip', stop: true }, { idem: 'filter-report-08' });
    expect(filter.status).toBe(201);
    const updated = await b.patch(`/mail/filters/${filter.body.id}`, { name: 'Báo cáo vào VIP', field: 'subject', operator: 'contains', value: 'báo cáo quý', addLabels: ['Khẩn', 'Khách hàng'], moveToFolder: 'vip', stop: true, enabled: true });
    expect(updated.body.addLabels).toEqual(['Khẩn', 'Khách hàng']);
    expect((await b.get('/mail/filters')).body.items).toHaveLength(1);
    if(process.env.RUN_MAIL_ENGINE_MANAGEMENT==='1'){await smtpOutsideApi(process.env.MAIL_TEST_A_PASSWORD!);const external=await b.get('/mail/messages?folder=vip&q=external-smtp-08&scope=body');expect(external.body.items.some((x:any)=>x.subject==='Báo cáo quý Ngoài API')).toBe(true);}

    await a.post('/mail/send', { to: ['nv.mkt@vcworkspace.test'], subject: `Báo cáo quý Alpha ${runTag}`, text: `Nội dung ${runTag}` }, { idem: 'search-hit-08' });
    await a.post('/mail/send', { to: ['nv.mkt@vcworkspace.test'], subject: 'Thư gây nhiễu kim-cương-08', text: 'Không có từ khóa thân thư' }, { idem: 'search-distractor-08' });
    const vip = await b.get(`/mail/messages?folder=vip&q=${encodeURIComponent(runTag)}&scope=body`); expect(vip.body.items).toHaveLength(1); expect(vip.body.items[0].labels).toEqual(['Khẩn', 'Khách hàng']);
    expect((await b.get(`/mail/messages?folder=vip&q=${encodeURIComponent(runTag)}&scope=subject`)).body.items).toHaveLength(1);
    expect((await b.get(`/mail/messages?folder=inbox&q=${encodeURIComponent(runTag)}&scope=body`)).body.items).toHaveLength(0);
    const relabeled = await b.patch(`/mail/messages/${vip.body.items[0].id}/labels`, { labels: ['Khẩn'] });
    expect(relabeled.body.labels).toEqual(['Khẩn']);
    expect((await b.get(`/mail/messages?folder=vip&label=Kh%E1%BA%A9n&q=${encodeURIComponent(runTag)}&scope=body`)).body.items).toHaveLength(1);
  });

  it('alias là identity riêng; chống spoofing và idempotency vẫn gắn với người gửi', async () => {
    const a = await t.login('tp.mkt'); const b = await t.login('nv.mkt');
    const alias = await a.post('/mail/aliases', { address: 'marketing@vcworkspace.test', displayName: 'Marketing' }, { idem: 'alias-marketing-08' });
    expect(alias.body).toMatchObject({ ownerEmail: 'tp.mkt@vcworkspace.test', address: 'marketing@vcworkspace.test', active: true });
    expect((await a.get('/mail/aliases')).body.items).toHaveLength(1);
    const sent = await a.post('/mail/send', { fromIdentity: alias.body.address, to: ['nv.mkt@vcworkspace.test'], subject: 'Từ alias', text: 'alias body' }, { idem: 'alias-send-08' });
    expect(sent.body.from).toBe(alias.body.address);
    const inbox = await b.get('/mail/messages?folder=inbox&q=T%E1%BB%AB%20alias&scope=subject'); expect(inbox.body.items[0].from).toBe(alias.body.address);
    expect((await b.post('/mail/send', { fromIdentity: alias.body.address, to: ['tp.mkt@vcworkspace.test'], subject: 'spoof', text: 'x' }, { idem: 'alias-spoof-08' })).status).toBe(403);
    expect((await a.post('/mail/aliases', { address: 'nv.mkt@vcworkspace.test', displayName: 'Giả mạo B' }, { idem: 'alias-primary-collision-08' })).status).toBe(409);
    expect((await a.post('/mail/shared-mailboxes', { address: alias.body.address, name: 'Trùng alias' }, { idem: 'shared-alias-collision-08' })).status).toBe(409);
    expect((await a.post('/mail/send', { fromIdentity: alias.body.address, to: ['nv.mkt@vcworkspace.test'], subject: 'khác', text: 'x' }, { idem: 'alias-send-08' })).status).toBe(409);
    await b.post('/mail/send', { to: [alias.body.address], subject: `Trả lời vào alias ${runTag}`, text: 'alias inbound body' }, { idem: 'alias-inbound-08' });
    const inbound = await a.get(`/mail/messages?folder=inbox&q=${encodeURIComponent(runTag)}&scope=subject`);
    expect(inbound.body.items).toHaveLength(1);
    const raw = await a.agent.get(`/api/v1/mail/messages/${inbound.body.items[0].id}/raw`).buffer(true).parse(binary as any);
    expect(raw.status).toBe(200); expect(Buffer.from(raw.body).toString('utf8')).toContain(Buffer.from('alias inbound body').toString('base64'));
  });

  it('shared mailbox tách quyền read/send/manage và thu hồi có hiệu lực ngay', async () => {
    const manager = await t.login('tp.mkt'); const member = await t.login('nv.mkt');
    const shared = await manager.post('/mail/shared-mailboxes', { address: 'mkt-team@vcworkspace.test', name: 'Nhóm MKT' }, { idem: 'shared-create-08' });
    expect(shared.body.members[0].roles).toEqual(expect.arrayContaining(['read', 'send', 'manage']));
    const granted = await manager.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: 'nv.mkt@vcworkspace.test', roles: ['read', 'send'] });
    expect(granted.body.members.find((x: any) => x.email === 'nv.mkt@vcworkspace.test').roles).toEqual(['read', 'send']);
    expect((await member.get('/mail/shared-mailboxes')).body.items).toHaveLength(1);
    const fromShared = await member.post('/mail/send', { fromIdentity: shared.body.address, mailbox: shared.body.address, to: ['tp.mkt@vcworkspace.test'], subject: `Gửi quyền nhóm ${runTag}`, text: 'shared body' }, { idem: 'shared-send-08' });
    expect(fromShared.body.from).toBe(shared.body.address);
    expect((await member.get(`/mail/messages?mailbox=${encodeURIComponent(shared.body.address)}&folder=sent&q=${encodeURIComponent(runTag)}&scope=subject`)).body.items).toHaveLength(1);
    const deliveredToShared = await manager.post('/mail/send', { to: [shared.body.address], subject: 'Thư vào nhóm', text: 'shared inbound body' }, { idem: 'shared-inbound-08' });
    expect(deliveredToShared.status).toBe(201);
    const sharedInbox = await member.get(`/mail/messages?mailbox=${encodeURIComponent(shared.body.address)}&folder=inbox`);
    expect(sharedInbox.body.items.some((x: any) => x.subject === 'Thư vào nhóm')).toBe(true);
    const inbound = sharedInbox.body.items.find((x: any) => x.subject === 'Thư vào nhóm');
    const raw = await member.agent.get(`/api/v1/mail/messages/${inbound.id}/raw?mailbox=${encodeURIComponent(shared.body.address)}`).buffer(true).parse(binary as any);
    expect(raw.status).toBe(200); expect(Buffer.from(raw.body).toString('utf8')).toContain(Buffer.from('shared inbound body').toString('base64'));
    await manager.post(`/mail/labels?mailbox=${encodeURIComponent(shared.body.address)}`, { name: 'Nhóm08', color: '#112233' }, { idem: 'shared-label-08' });
    expect((await member.patch(`/mail/messages/${inbound.id}/labels?mailbox=${encodeURIComponent(shared.body.address)}`, { labels: ['Nhóm08'] })).body.labels).toEqual(['Nhóm08']);
    expect((await manager.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: 'nv.mkt@vcworkspace.test', roles: ['send'] })).status).toBe(400);
    await manager.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: 'nv.mkt@vcworkspace.test', roles: ['manage'] });
    expect((await member.get(`/mail/messages?mailbox=${encodeURIComponent(shared.body.address)}&folder=inbox`)).status).toBe(403);
    expect((await member.post('/mail/send', { fromIdentity: shared.body.address, to: ['tp.mkt@vcworkspace.test'], subject: 'Manage only', text: 'x' }, { idem: 'shared-manage-only-08' })).status).toBe(403);
    expect((await member.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: 'tp.mkt@vcworkspace.test', roles: [] })).status).toBe(200);
    expect((await member.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: 'tp.mkt@vcworkspace.test', roles: ['read', 'send', 'manage'] })).status).toBe(200);
    if(process.env.RUN_MAIL_ENGINE_MANAGEMENT==='1')expect(await sharedFolderVisible('nv.mkt@vcworkspace.test',process.env.MAIL_TEST_B_PASSWORD!,shared.body.address)).toBe(false);
    await manager.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: 'nv.mkt@vcworkspace.test', roles: [] });
    expect((await member.get(`/mail/messages?mailbox=${encodeURIComponent(shared.body.address)}&folder=sent`)).status).toBe(403);
    expect((await member.post('/mail/send', { fromIdentity: shared.body.address, to: ['tp.mkt@vcworkspace.test'], subject: 'Sau thu hồi', text: 'x' }, { idem: 'shared-revoked-08' })).status).toBe(403);
    expect((await manager.get(`/mail/messages?mailbox=${encodeURIComponent(shared.body.address)}&folder=sent&q=${encodeURIComponent(runTag)}&scope=subject`)).body.items.map((x: any) => x.subject)).toContain(`Gửi quyền nhóm ${runTag}`);
  },90000);

  it('từ chối dữ liệu vòng lặp/chèn header và tài nguyên mailbox khác', async () => {
    const a = await t.login('tp.mkt'); const b = await t.login('nv.mkt');
    const finite = await a.post('/mail/filters', { name: 'Không chuyển tiếp', field: 'subject', operator: 'contains', value: 'x', forwardTo: 'tp.mkt@vcworkspace.test' }, { idem: 'filter-loop-08' });
    // OpenAPI chỉ nhận hành động nhãn/thư mục; field ngoài schema bị loại và không thể tạo vòng gửi.
    expect(finite.status).toBe(201); expect(finite.body.forwardTo).toBeUndefined();
    expect((await a.post('/mail/labels', { name: 'x\r\nBcc: bad', color: '#FFFFFF' }, { idem: 'label-header-08' })).status).toBe(400);
    expect((await a.post('/mail/aliases', { address: 'bad@example.com', displayName: 'bad' }, { idem: 'alias-outside-08' })).status).toBe(400);
    const other = await b.post('/mail/labels', { name: 'Riêng B', color: '#111111' }, { idem: 'label-b-private-08' }); expect(other.status).toBe(201);
    expect((await a.patch('/mail/messages/000000000000000000000000/labels', { labels: ['Riêng B'] })).status).toBe(400);
  });

  it('offboarding khoá user, alias, quyền nhóm và toàn bộ phiên', async()=>{
    if(process.env.RUN_MAIL_ENGINE_MANAGEMENT==='1')return;
    const hr=await t.login('hcns'),target=await t.login('xem.mkt');
    await t.db.m.WorkspaceMailAlias.create({companyId:t.ids.companyId,ownerEmail:'xem.mkt@vcworkspace.test',address:'xem-cu@vcworkspace.test',active:true});
    await t.db.m.WorkspaceSharedMailbox.create({companyId:t.ids.companyId,address:'xem-team@vcworkspace.test',name:'Xem team',members:[{email:'xem.mkt@vcworkspace.test',roles:['read']},{email:'tp.mkt@vcworkspace.test',roles:['manage']} ]});
    const result=await hr.post(`/mail/offboarding/${t.ids.users['xem.mkt']}`,{}, {idem:'offboard-xem-08'});expect(result.body).toMatchObject({userId:t.ids.users['xem.mkt'],address:'xem.mkt@vcworkspace.test',status:'left'});
    expect(await t.db.m.Session.countDocuments({companyId:t.ids.companyId,userId:t.ids.users['xem.mkt']})).toBe(0);
    expect((await t.db.m.WorkspaceMailAlias.findOne({companyId:t.ids.companyId,address:'xem-cu@vcworkspace.test'}).lean<any>()).active).toBe(false);
    expect((await t.db.m.WorkspaceSharedMailbox.findOne({companyId:t.ids.companyId,address:'xem-team@vcworkspace.test'}).lean<any>()).members.some((x:any)=>x.email==='xem.mkt@vcworkspace.test')).toBe(false);
    expect((await target.get('/mail/aliases')).status).toBe(401);
  });
});
