# NEEDS-VALIDATION — VCdocs run-1 (quick)

Prioritized leads without severity. Each is a source-grounded boundary hypothesis whose decisive fact is outside source or needs a bounded local run that this run could not execute. No live-probe guidance.

## 1. ONLYOFFICE callback accepts any JWT signed with the editor secret, including the browser-issued config token, and trusts unsigned body fields

Fingerprint: `drive-basic/editor-callback/jwt-signature-only-unbound-payload`

POST /drive/editor/callback is @Public and @SkipCsrf. Apart from the edit-mode ticket, its only proof that the request comes from the Document Server is verifyJwt. verifyJwt recomputes the HMAC over header.body and compares it, but never parses the header or payload: it pins no algorithm, checks no exp, and never compares signed claims with body.key, body.status or body.url. The API signs the browser editor config with the same documentEditor.jwtSecret and returns that token, with no exp, to every user who opens the editor, readers included. Any browser user therefore holds a token that passes verifyJwt. A user who also holds an edit-mode ticket (issued only to space managers, inside editorConfig.callbackUrl, and valid for 15 minutes) can post a callback with status 2 or 6, the current editor key, and any URL whose protocol, host and port equal documentEditor.internalOrigin. The API fetches that URL, checks that the bytes are a valid OOXML package of the file's kind, and commits them as a new current version attributed to the ticket's user. Within the attacker's own capability this adds little, because a manager can already POST /drive/files/:id/versions. The extra capability is that the server fetches an attacker-chosen path on the Document Server internal origin and stores the bytes. If that origin serves another document's cached output by key without a per-request signature, or if internalOrigin reaches a different internal service, this lets one user pull other users' document bytes into their own Drive. The callback-signature control gives no assurance beyond the ticket. The decisive impact facts are about deployment, not source.

**Claimed root cause.** verifyJwt (apps/api/src/modules/drive-basic/drive-basic.service.ts:534-539) checks only the signature and shares its key with tokens the API itself issues to browsers (jwt() :403-407, returned at :429). editorCallback (:480-490) takes key, status and url from the unsigned request body instead of from the verified token payload, and restricts url only to the internalOrigin protocol, host and port.

**Trace**

- entrypoint: `apps/api/src/modules/drive-basic/drive-basic.controller.ts:94` (DriveBasicController.editorCallback) — @Public @SkipCsrf POST drive/editor/callback passes the ticket query, the raw body and the Authorization header to the service.
- propagation: `apps/api/src/modules/drive-basic/drive-basic.service.ts:429` (DriveBasicService.editorConfig) — Returns config.token = jwt(config) to the browser: HS256 with documentEditor.jwtSecret and no exp claim. callbackUrl at :425 carries the edit ticket when the caller's space role is manager (:415).
- propagation: `apps/api/src/modules/drive-basic/drive-basic.service.ts:480` (DriveBasicService.editorCallback) — The token is taken from the Authorization header or body.token and passed to verifyJwt (:481). View-mode tickets are rejected first (:478).
- propagation: `apps/api/src/modules/drive-basic/drive-basic.service.ts:537` (DriveBasicService.verifyJwt) — Recomputes the HMAC over header.body and compares it with timingSafeEqual. The payload is never parsed, so there is no exp, aud, iss or body binding.
- propagation: `apps/api/src/modules/drive-basic/drive-basic.service.ts:483` (DriveBasicService.editorCallback) — editorKey and url come from the unsigned body. The only checks are the key prefix (:485), the current-version key (:506) and the internalOrigin protocol, host and port for url (:489).
- sink: `apps/api/src/modules/drive-basic/drive-basic.service.ts:514` (DriveBasicService.editorCallback) — Bytes fetched from the body-supplied url (:507) that pass validOfficePackage (:511) are stored and committed as the new current version (:516-521).

**Evidence**

- `apps/api/src/modules/drive-basic/drive-basic.service.ts:538` — verifyJwt returns true whenever the signature matches. No claim is checked.
- `apps/api/src/modules/drive-basic/drive-basic.service.ts:389` — sign() uses cfg.documentEditor.jwtSecret for tickets, browser config tokens and converter tokens alike.
- `apps/api/src/modules/drive-basic/drive-basic.service.ts:404` — jwt() emits the header {alg:HS256,typ:JWT} and the payload as given. The editorConfig payload has no exp.
- `apps/api/src/modules/drive-basic/drive-basic.service.ts:489` — The only restriction on the fetched url is that protocol, hostname and port equal internalOrigin. Any path is accepted.
- `apps/api/src/modules/drive-basic/drive-basic.service.ts:265` — Calibration: uploadVersion already lets a manager commit a new version directly, so the forged callback matters only through the server-side fetch of an internal-origin path.
- `apps/api/src/config/config.ts:202` — internalOrigin defaults to the same value as publicOrigin (:201). The deployed values are not source-visible.

**Blockers**

- Target-controlled execution is blocked in this run: the host cannot OS-enforce memory, process and disk limits. Acceptance of a forged callback that carries a browser-held config token was therefore not observed locally.
- It is not source-visible whether the deployed ONLYOFFICE 9.4 Document Server, at its internal origin, serves other documents' cached or output files at paths that are guessable or known from a key, without a per-request md5/expires signature. This decides whether the impact goes beyond what the manager can already do through uploadVersion.
- Whether documentEditor.internalOrigin in the deployed api.env points only at the Document Server, and not at a shared host with other internal services on the same port, is not source-visible.

**Resolution plan**

- Local (bounded fixture): Use the Jest harness apps/api/test/support/app.ts with fake storage and documentEditor.enabled=true, with internalOrigin set to a loopback port where a test-local HTTP fixture returns the minimal DOCX bytes from createDocumentTemplate. (1) As a dummy manager, GET /api/v1/drive/files/:id/editor-config on a DOCX file. Take config.token, and take the ticket from config.editorConfig.callbackUrl. (2) POST /api/v1/drive/editor/callback?ticket=<ticket> with the header 'Authorization: Bearer <config.token>' and the body {status:2,key:'vcw-<id>-v1',url:'<internalOrigin>/arbitrary/path.docx'}. Expect {error:0}, versionNumber 2, and a fixture hit on /arbitrary/path.docx. That shows a browser-issued token is accepted as Document Server proof and that the fetch path is unbound. Negative control: a token signed with a different secret returns {error:1}. Regression: verifyJwt must decode the payload, pin HS256, require exp, and require the token payload (or payload.payload for header tokens) to carry key, status and url equal to the values used. Browser config tokens must be signed with a key or audience that callback verification rejects.
- Owner-observed: The owner checks the deployed ONLYOFFICE local.json: whether services.CoAuthoring.secret.browser, inbox and outbox use distinct secrets, and whether the API's DOCUMENT_EDITOR_JWT_SECRET matches only the outbox secret. The owner also checks, from the Document Server host configuration and nginx rules and not through audit traffic, whether cache/files output URLs require the secure-link md5/expires signature. Finally, the owner confirms what host and port DOCUMENT_EDITOR_INTERNAL_ORIGIN resolves to in api.env.

## 2. Drive department-space membership and manager role persist after a user changes department or loses R4

Fingerprint: `drive-basic/space-membership/never-reconciled-after-role-or-department-change`

Drive space membership is created lazily on GET /spaces by ensureDefaultSpaces. That function upserts a WorkspaceSpaceMember row and sets the role only on insert, computing it from whether the user holds R4 at that moment. The user's departmentId and systemRoles can change later: Google sync applyAccess rewrites both, an R9 PATCH /users/:id rewrites systemRoles, and the OIDC callback rewrites systemRoles from IdP groups. None of these paths touches WorkspaceSpaceMember, and nothing in apps/api/src deletes or updates a membership row. A user moved to another department keeps the old department-space row. A head of department who loses R4 keeps role manager in that space. Every drive-basic authorization (member(), assertManager, activeItem) reads only this table. So the former member can keep listing and downloading the old department's files, and a demoted manager can keep uploading, renaming, trashing, restoring versions and getting edit-mode ONLYOFFICE tickets there, with no time limit. The stale row also satisfies the recipient-membership check in workspace-interop for Drive links.

**Claimed root cause.** ensureDefaultSpaces (apps/api/src/modules/drive-basic/drive-basic.service.ts:46-74) only adds rows: it uses $setOnInsert for the role (:69-71) and never reconciles existing memberships against the current departmentId and systemRoles. member() (:31-36) then treats any stored row as current authority, and the department and role change paths (google-sync.service.ts:101-115, users.controller.ts:136-153, auth.controller.ts:124) never revoke or recompute it.

**Trace**

- entrypoint: `apps/api/src/modules/drive-basic/drive-basic.controller.ts:18` (DriveBasicController.upload) — An authenticated user calls POST drive/files. The sibling routes items, content, updateItem, trash, restoreVersion and editorConfig follow the same path.
- propagation: `apps/api/src/modules/drive-basic/drive-basic.service.ts:131` (DriveBasicService.upload) — assertManager(ctx, input.spaceId) is the only authorization.
- propagation: `apps/api/src/modules/drive-basic/drive-basic.service.ts:32` (DriveBasicService.member) — Looks up WorkspaceSpaceMember by companyId, spaceId and userId and returns the stored role. It does not consult the user's current departmentId or R4.
- propagation: `apps/api/src/modules/drive-basic/drive-basic.service.ts:69` (DriveBasicService.ensureDefaultSpaces) — Calls updateOne with {$setOnInsert:{role}} and upsert:true. An existing role is never changed, and rows for previous departments are never deleted.
- propagation: `apps/api/src/modules/m01-auth/google-sync.service.ts:113` (GoogleSyncService.applyAccess) — Rewrites departmentId and systemRoles (:106-111) on sync without touching Drive memberships.
- sink: `apps/api/src/modules/drive-basic/drive-basic.service.ts:171` (DriveBasicService.upload) — A file is created in the former department's space. Reads and edits of that space's content are authorized the same way.

**Evidence**

- `apps/api/src/modules/drive-basic/drive-basic.service.ts:68` — The role is computed from the current R4 only at first insert.
- `apps/api/src/modules/drive-basic/drive-basic.service.ts:70` — $setOnInsert means a later demotion is never applied.
- `apps/api/src/modules/m01-auth/users.controller.ts:146` — R9 can change systemRoles, for example remove R4, with no Drive membership update.
- `apps/api/src/modules/m01-auth/auth.controller.ts:124` — OIDC login overwrites systemRoles from IdP groups with no Drive membership update.
- `apps/api/src/db/models.ts:207` — The WorkspaceSpaceMember schema has no source or derivation field, so stale rows cannot be told apart from current ones. The only writer in apps/api/src is drive-basic.service.ts:69.
- `apps/api/src/modules/workspace-interop/workspace-interop.service.ts:53` — Recipient Drive-link authorization also trusts any existing WorkspaceSpaceMember row.

**Blockers**

- Target-controlled execution is blocked in this run: the host cannot OS-enforce memory, process and disk limits. The stale-access sequence was therefore not observed locally, even though source shows no code path that removes or downgrades the membership.

**Resolution plan**

- Local (bounded fixture): In the Jest harness apps/api/test/support/app.ts with fake Google and fake storage: seed dummy departments D1 and D2 in one dummy company, and a dummy user U in D1 holding R4. As U, call GET /api/v1/spaces and record D1's space id and role manager. Then set U.departmentId=D2 and remove R4, either through GoogleSyncService.applyAccess or through PATCH /api/v1/users/:id by a dummy R9 (groupRoles empty). As U, call GET /api/v1/spaces again, then POST /api/v1/drive/files (multipart, text/plain, Idempotency-Key set) with spaceId set to D1's space. Expect D1's space still listed with role manager and the upload to return 201. A second dummy user who never belonged to D1 must get 404 on the same upload (control). Regression: ensureDefaultSpaces, or the sync, role and OIDC paths, must delete department memberships that do not match the current departmentId and must recompute the role from the current R4. A test must assert the 404 and 403 after the change.

## 3. R3 can read approval slips of confidential drives without being a member

Fingerprint: `legacy/approvals-load:R3-bypass-confidential-drive`

ApprovalsController.load lets any R3 user skip the visibility and relatedness check entirely: `if (!isRelated && !hasRole('R3'))`. The approval's driveId is never checked. GET /approvals/:id therefore returns, to any R3 user, approval slips on confidential drives they are not members of. These include document submissions, record approvals and external-share approvals of confidential files. toApi drops only meta, checkComment and driveId. The response still exposes objectTitle (for external shares 'Chia se <fileName> cho <external email>'), snapshot links such as viewUrl and pdfFileId, the decision comment, and the approver, checker and submitter. The contract describes GET /approvals/{id} as 'related people' only (openapi.yaml:1183) and says that objects on a confidential drive the caller may not view return 404 (line 28). The sibling AccessService.assertVisibleOrR3 deliberately excludes confidential drives from the R3 exemption. Mutating actions (check, decide, cancel) are still bound to the slip's principals in the service, so this is a read exposure only. remind by R3 is allowed by the contract.

**Claimed root cause.** ApprovalsController.load short-circuits for R3 with `!isRelated && !hasRole('R3')` and never consults the security level of a.driveId. It should use assertVisibleOrR3(ctx, a.driveId, isRelated) or an equivalent check.

**Trace**

- entrypoint: `apps/api/src/modules/m05-approvals/approvals.controller.ts:69` (ApprovalsController.get) — GET /approvals/:id by any authenticated user
- propagation: `apps/api/src/modules/m05-approvals/approvals.controller.ts:61` (ApprovalsController.load) — An R3 user short-circuits the check; assertVisible(a.driveId) is reached only by non-R3 users who are not participants
- sink: `apps/api/src/modules/m05-approvals/approvals.service.ts:171` (ApprovalsService.toApi) — Returns the full slip, omitting only meta, checkComment and driveId

**Evidence**

- `apps/api/src/access/access.service.ts:132` — assertVisibleOrR3 exempts R3 only when securityOfDrive is not confidential
- `contract/openapi.yaml:28` — Contract rule: objects on a confidential drive the caller may not view return 404
- `contract/openapi.yaml:1183` — GET /approvals/{id} summary limits slip details and snapshot link to related people
- `apps/api/src/modules/m09-shares/shares.controller.ts:182` — Confidential external shares create approvals whose objectTitle contains the file name and the external email, with driveId = the confidential drive

**Blockers**

- Target-controlled execution is blocked in this run: the host cannot OS-enforce memory, process-count and disk limits, and no local Node container image exists, so the Jest harness could not be run
- Whether the product owner intends R3 (document control) to oversee approval metadata on confidential drives is a policy fact that source does not settle; the contract lists R3 only for remind, and assertVisibleOrR3 suggests confidential drives are excluded

**Resolution plan**

- Local (bounded fixture): In apps/api/test/support/app.ts, seed a confidential department C and an external-share approval that is pending on C's drive (created via POST /shares by a writer of C). Add an R3 user who is not a member of C and not a participant. As that R3 user, GET /approvals/:id. Today this is expected to return 200 with objectTitle containing the external email. The intended result is 404. Add a regression test after load() is switched to assertVisibleOrR3(ctx, a.driveId, isRelated).
- Owner-observed: The owner records the policy decision on whether R3 may view approval slips of confidential drives they are not a member of.

## 4. External-document import copies any Drive file with service-account authority into a caller-chosen department

Fingerprint: `legacy/external-documents-import:fileId-service-account-copy-without-source-authorization`

POST /external-documents is open to R1-R6 and R8 (R6_UP, documents.controller.ts:22,535). It takes a Google fileId and any departmentId from the body. Before queuing the job it checks only three things: the department exists in the company (deptById), the url is https, and the write service account can getFile the fileId. Nothing ties the fileId to a VCdocs object the caller may read, and nothing checks the caller's role on the target department's drive. runImportExternal then copies the file with service-account authority into that department's 00 Tai lieu/EXT folder. It registers an effective EXT Document with the department's driveId and securityLevel and records the caller as createdBy. The contract doc says the service account is Manager on all 11 shared drives. So an R6 employee who knows or obtains the fileId of a file on a confidential drive they are not a member of could have it copied into a drive they can read, such as their own department or the internal 00 VCPV Chung drive that every user can see. They would get a readable copy. The same caller can also make the service account write effective EXT documents into a confidential department they do not belong to. A narrower variant has the same root cause. A head of department (R4, requireHeadOf on their own department) can store an arbitrary templateId on a record type, because templateId is in FIELDS and is written without validation on create and update. records.service runCreate then copies rt.templateId with the service account into the record folder. In contrast, the sibling shares.create resolves the fileId to a registered owner object, calls assertVisible and requires writer before any service-account action.

**Claimed root cause.** Caller-supplied Google fileIds (body.fileId in importExternal, templateId in record-types) are passed to the service account's getFile and copyFile without being bound to a VCdocs object the caller may read. importExternal also never checks the caller's drive role on the body-supplied departmentId. The sibling shares.create does both through owner(), assertVisible and driveRole.

**Trace**

- entrypoint: `apps/api/src/modules/m04-documents/documents.controller.ts:534` (DocumentsController.importExternal) — POST /external-documents, @Roles(R6_UP = R1-R6,R8); body.fileId and body.departmentId come straight from the request body
- propagation: `apps/api/src/modules/m04-documents/documents.controller.ts:539` (DocumentsController.importExternal) — deptById(ctx.companyId, body.departmentId) only checks that the department exists; there is no isHeadOf, driveRole or assertVisible check on the target department
- propagation: `apps/api/src/modules/m04-documents/documents.controller.ts:542` (DocumentsController.importExternal) — google.drive.getFile(body.fileId) is the only check on the source file, and it runs as the service account, not as the caller
- propagation: `apps/api/src/modules/m04-documents/documents.controller.ts:544` (DocumentsController.importExternal) — The whole request body is enqueued as the external_document.import job payload
- sink: `apps/api/src/modules/m04-documents/documents.controller.ts:555` (DocumentsController.runImportExternal) — google.drive.copyFile({fileId: p.fileId, parentGoogleId: root.googleId}) copies the file into the target department's EXT folder, then a Document is created with status effective, that department's driveId and securityLevel, and createdBy = the caller

**Evidence**

- `apps/api/src/google/real/real-google.ts:222` — copyFile calls files.copy with the write service-account client and supportsAllDrives; no per-user impersonation
- `docs/hop-dong-api/hop-dong-api-v1.md:399` — Both service accounts are Manager on all 11 shared drives
- `apps/api/src/modules/m09-shares/shares.controller.ts:154` — Sibling control: shares.create resolves fileId through owner() (line 152), then calls assertVisible and requires writer on the owner's drive before any service-account action
- `apps/api/src/access/access.service.ts:120` — assertVisible returns 404 for confidential drives that are not in ctx.visibleDriveIds; importExternal never calls it
- `apps/api/src/modules/m06-record-types/record-types.controller.ts:15` — Variant: templateId is in FIELDS and is copied from the body on create (line 134) and update (line 171); checkRefs validates only folderId
- `apps/api/src/modules/m07-records/records.service.ts:162` — Variant sink: runCreate copies rt.templateId with the service account into the record's month folder

**Blockers**

- Target-controlled execution is blocked in this run: the macOS host cannot OS-enforce memory, process-count and disk limits, and no local Node container image exists, so the Jest harness (apps/api/test/support/app.ts) could not be run to reproduce the copy
- Deployment facts outside source decide the real impact: whether the deployed write service account really holds Manager on the confidential shared drives, and whether ordinary employees can open the copied file through Google Drive membership of the target drive (for example the internal drive)

**Resolution plan**

- Local (bounded fixture): Use apps/api/test/support/app.ts with fake Google. Seed a confidential department B whose drive holds a file F, and an R6 user U who is a writer only on department A's drive and is not a member of B. As U, POST /external-documents {fileId: F, departmentId: A, source, number, title, issuedAt} with CSRF and Idempotency headers. Expect 202 and run the job. Assert that a new EXT Document exists with driveId = A's drive and fileId != F, that U gets 200 on GET /documents/:id, and that the fake drive copy holds F's content. Repeat with departmentId = B and assert that an effective EXT document is created on B's confidential drive although U is not a member. Variant: as the R4 head of A, PATCH /record-types/:id {templateId: F}, then POST /records for that type, run the job, and assert the fake drive copy of F lands in A's record folder. Regression: once the source fileId is bound to a VCdocs object the caller may read and the caller's role on the target drive is checked, all three requests must return 403 or 404.
- Owner-observed: The owner checks in the Google Workspace admin console, with no traffic to the live API, that the VCdocs write service account is Manager on the confidential shared drives. The owner also checks which Google groups are members of the internal and department shared drives, which decides who could open an imported copy.

## 5. Record claim treats the last modifier as the file creator and moves the file with service-account authority

Fingerprint: `legacy/records-claim:creator-check-uses-lastModifyingUser`

POST /records/claim lets the creator of a Drive file, or the head of the source department, register an unregistered file as a record. The real Google adapter fills DriveFileMeta.createdByEmail from lastModifyingUser.emailAddress. FILE_FIELDS never asks for any creator field, and on shared drives files.get has no owner. RecordsController.claim compares that value with ctx.user.email as proof of authorship. On the source drive it requires only assertVisible, and every user can see the internal drive. Any user who can edit a file in a visible drive and makes the latest edit therefore passes the creator check for a file someone else created. validateInput then requires writer only on the destination record type's drive, and the record type comes from the body, so it can belong to a different department and drive. runClaim uses the service account's updateFile with addParents and removeParents to move the file out of its source shared drive into the caller's record-type folder and rename it. It then inserts a Record with createdBy = the caller. A Contributor (writer) cannot move files out of a shared drive on Google Drive alone. Afterwards the caller holds creator powers on the record, because isCreator compares record.createdBy. The fake adapter stores a true creator (createLooseFile), so the tests do not exercise this mapping.

**Claimed root cause.** real-google.ts toMeta maps createdByEmail from f.lastModifyingUser.emailAddress, and records.controller claim uses that field as proof of authorship before a service-account move. The source-drive check is only visibility, not a role that would allow the move.

**Trace**

- entrypoint: `apps/api/src/modules/m07-records/records.controller.ts:163` (RecordsController.claim) — POST /records/claim by any authenticated user, with caller-supplied body.fileId and body.recordTypeId
- propagation: `apps/api/src/modules/m07-records/records.controller.ts:169` (RecordsController.claim) — assertVisible(ctx, meta.driveId) only needs drive visibility; the internal drive is visible to every signed-in user (access.service.ts loadAccess)
- propagation: `apps/api/src/google/real/real-google.ts:76` (toMeta) — createdByEmail: f.lastModifyingUser?.emailAddress, so the value is the last editor, not the creator
- propagation: `apps/api/src/modules/m07-records/records.controller.ts:170` (RecordsController.claim) — creator = createdByEmail.toLowerCase() === ctx.user.email; the last editor passes, and isHeadOf is only an alternative
- sink: `apps/api/src/modules/m07-records/records.service.ts:223` (RecordsService.runClaim) — Service-account updateFile with addParents = the caller's record month folder and removeParents = all original parents, then insertRecord with createdBy = the caller (isClaimed: true)

**Evidence**

- `apps/api/src/google/real/real-google.ts:38` — FILE_FIELDS requests only lastModifyingUser(emailAddress); no creator or owner information is fetched
- `apps/api/src/modules/m07-records/records.service.ts:115` — validateInput requires writer only on the destination record type's drive; the source drive needs mere visibility
- `apps/api/src/modules/m07-records/records.controller.ts:154` — /records/unregistered shows the same field to users as ownerEmail, which shows that creator semantics were intended
- `apps/api/src/google/fake/fake-google.ts:184` — The fake createLooseFile sets createdByEmail to a true creator, so the tests never exercise the lastModifyingUser mapping

**Blockers**

- Target-controlled execution is blocked in this run: the host cannot OS-enforce memory, process-count and disk limits, and no local Node container image exists, so the Jest harness could not be run
- Real Google Drive behaviour cannot be observed from source or the fake adapter: on shared drives, lastModifyingUser becomes the other user after their edit, and whether ordinary staff hold edit rights on internal-drive or other visible-drive files decides who can become the last modifier

**Resolution plan**

- Local (bounded fixture): In apps/api/test/support/app.ts with fake Google, change the fake for this test so that createdByEmail reflects the last modifier, as real-google.ts does (for example createLooseFile with createdByEmail = B's email for a file conceptually created by A). Put the file F on the internal drive. User B is a writer only on department X's drive, which has an approved record type RT with a folder. As B, POST /records/claim {fileId: F, recordTypeId: RT, kind, functionCode, subject, workMonth} with CSRF. Assert 202, that the job removes F's internal-drive parent and adds X's record folder, and that the new Record has createdBy = B. Regression: when the creator is derived from a real creator source (for example the first revision's lastModifyingUser) or the source drive requires fileOrganizer, the same request returns 403.
- Owner-observed: In a test Workspace domain with dummy accounts, the owner confirms that files.get lastModifyingUser on a shared-drive file changes to user B after B edits a file created by user A. The owner also confirms whether ordinary employees have Contributor or higher on the internal shared drive. No traffic goes to the live VCdocs API.

## 6. Production accepts the fake identity-lifecycle port, so demotion and offboarding report 'done' without reaching Authentik/Nextcloud, and the next login restores roles

Fingerprint: `m01-auth/identity-lifecycle/fake-port-allowed-in-production`

IDENTITY_LIFECYCLE_MODE defaults to 'fake', and loadConfig never rejects it when NODE_ENV=production. The production block rejects only fake storage, fake mail and a weak editor secret. The only alternative, the 'local' port, is restricted to 127.0.0.1, localhost, authentik.localtest.me and nextcloud.localtest.me. So a production OIDC deployment with a real Authentik on another host can only run the fake port. With the fake port, the authentik and nextcloud steps write to an in-process Map and read back the same value, so every step and the operation complete with status 'done'. App-side effects are real: denyApp and commitApp set binding.active, isSuspended and systemRoles and delete sessions, so an app deactivation (active=false) does lock the app login (auth.controller.ts:106). The Authentik and Nextcloud accounts and their tokens, however, stay active. An R9 role or email change is applied only to the app User and binding. The user's next OIDC login recomputes systemRoles from the unchanged IdP token groups and rewrites the email from the verified token email, so a demoted R9/R3/R4 regains the role on re-login. OIDC sessions are destroyed after projectionMaxAge (default 300s) without a login, which makes re-login routine. Whether production runs AUTH_MODE=oidc at all is a deployment fact: deploy/api.env.example sets GOOGLE_MODE=real and no AUTH_MODE, so the default is google.

**Claimed root cause.** config.ts has no production fail-fast for identityLifecycle.mode === 'fake' (and offers no production-capable port). Meanwhile the OIDC callback treats token groups and email as authoritative for systemRoles and email on every login, so an app-only lifecycle commit is silently undone.

**Trace**

- entrypoint: `apps/api/src/modules/m01-auth/identity-lifecycle.controller.ts:12` (IdentityLifecycleController.create) — R9-only (class-level @Roles('R9'), line 7) POST /identity/lifecycle-operations with desired {subject,email,groups,active}.
- propagation: `apps/api/src/config/config.ts:160` (loadConfig) — The lifecycle mode defaults to 'fake'. The production block at lines 259-266 checks storage, mail and the editor secret, but not identityLifecycle.
- propagation: `apps/api/src/modules/m01-auth/m01.module.ts:15` (M01Module providers) — Any mode other than 'local' wires FakeIdentityLifecyclePort.
- propagation: `apps/api/src/modules/m01-auth/identity-lifecycle.port.ts:21` (FakeIdentityLifecyclePort.apply) — Authentik/Nextcloud apply is a Map.set, and readAuthentik/readNextcloud (lines 24, 26) return the same row, so readback always matches.
- propagation: `apps/api/src/modules/m01-auth/identity-lifecycle.service.ts:198` (IdentityLifecycleService.commitApp) — App User email, systemRoles and isSuspended are set from desired. The operation is marked done at line 149.
- sink: `apps/api/src/modules/m01-auth/auth.controller.ts:124` (AuthController.oidcCallback) — The next login sets systemRoles from the IdP token groups (line 122) and email from the verified token email (line 123). Those were never changed upstream, so the demotion or email change is reverted.

**Evidence**

- `apps/api/src/config/config.ts:250` — The local lifecycle port is limited to 127.0.0.1/localhost/authentik.localtest.me/nextcloud.localtest.me, so no lifecycle port can reach a non-local Authentik.
- `apps/api/src/config/config.ts:261` — The sibling production fail-fast rejects fake workspace storage (and fake mail at line 262), but there is no equivalent check for the identity lifecycle.
- `apps/api/src/modules/m01-auth/identity-lifecycle.service.ts:142` — Step success depends only on the port's readback equality, which the fake port always satisfies.
- `apps/api/src/modules/m01-auth/auth.controller.ts:122` — roles = this.oidc.roles(claims.groups) is applied unconditionally on every OIDC login.
- `apps/api/src/modules/m01-auth/auth.controller.ts:106` — Mitigation: binding.active === false blocks app login, so an app-side deactivation itself holds. The revert affects role and email changes, plus upstream accounts that are never disabled.
- `apps/api/src/common/auth.guard.ts:47` — OIDC sessions are destroyed once lastSeenAt is older than projectionMaxAge, which forces a re-login that re-applies IdP groups.
- `deploy/api.env.example:9` — The production env template configures GOOGLE_MODE=real and no AUTH_MODE (default google), so OIDC use in production is not source-visible.

**Blockers**

- The deployed api.env is not visible (and must not be read): whether production runs AUTH_MODE=oidc, and with which IDENTITY_LIFECYCLE_MODE. The committed template implies Google mode, in which this path is unreachable.
- Whether the Authentik/Nextcloud accounts that are never revoked are reachable directly by end users, which decides the impact beyond the role and email revert, is a deployment and network fact.
- Target-controlled execution is blocked in this run: the host cannot OS-enforce memory, process-count or disk limits, and no local Node container image exists. So the Jest harness was not run.

**Resolution plan**

- Local (bounded fixture): With createTestApp (apps/api/test/support/app.ts) in authMode 'oidc', groupRoleMap {'vcw-admin':['R9']} and the default fake lifecycle port, log in subject S with token groups ['vcw-admin'] and assert User.systemRoles == ['R9']. As a second seeded R9 user, POST /api/v1/identity/lifecycle-operations with an Idempotency-Key, the CSRF header and {subject:S, email:<S email>, groups:[], active:true}. Assert status 'done' and User.systemRoles []. Then repeat the mocked OIDC callback for S with token groups ['vcw-admin'] and observe systemRoles restored to ['R9'] and a 302 to the web origin. Separately, in a unit test, assert that loadConfig({NODE_ENV:'production', AUTH_MODE:'oidc', IDENTITY_LIFECYCLE_MODE unset, with otherwise-valid production values for HTTPS origins, COOKIE_SECURE, WORKSPACE_STORAGE_MODE=nextcloud, MAIL_ENGINE_MODE=stalwart and a 32-byte editor secret}) does not throw today. Fix: throw in production when authMode === 'oidc' and identityLifecycle.mode === 'fake', and provide a production-capable port, or disable the lifecycle routes so operations fail closed instead of reporting done.
- Owner-observed: The owner inspects the production api.env, on the host, without sharing values, for AUTH_MODE and IDENTITY_LIFECYCLE_MODE. If OIDC is in use, the owner confirms in the Authentik admin UI and the Nextcloud user list whether an identity that a lifecycle operation reported as 'done' (deactivated or demoted) is still active or still in its original groups upstream.

## 7. OIDC callback provisions and re-emails users without checking the company email domain, which enables local-part mailbox and share-link collisions

Fingerprint: `m01-auth/oidc-callback/email-domain-not-bound-to-company-domain`

When AUTH_MODE=oidc, the callback creates a company User for any unbound (iss,sub) whose ID token has email_verified=true. On every later login it also sets User.email to the token's verified email. Neither path compares the email domain with cfg.oidc.companyDomain, which is used only to load the Company row. OidcService.validateIdToken checks the signature, iss, aud/azp, exp, iat, nonce and that sub and email are present, but not the email domain. User uniqueness and the pre-create check use the full address only. The mail layer (MailBasicService.owner) and the Drive share-link check (WorkspaceInteropService.downloadLink) identify a principal by the email local-part rewritten to @vcworkspace.test. So an IdP identity with verified email alice@other.example maps to the same mailbox owner as alice@<company> for list/thread/raw/send/drafts/filters, shared-mailbox ACL membership and share-link recipient checks. assertRecipientsCanRead resolves ^alice@ with any domain to whichever user it finds first. The Google callback enforces claims.hd === domain and the email suffix, which shows the intended invariant. Exploitability depends on IdP policy: whether a lower-trust person can hold an Authentik account for this client with a verified email outside the company domain (self-enrollment, a user-editable email, or an email_verified mapping that is always true).

**Claimed root cause.** AuthController.oidcCallback trusts claims.email for identity and mailbox derivation without binding it to cfg.oidc.companyDomain. There is no domain-suffix check at provisioning (auth.controller.ts:110-113) or at the email rewrite (:123-124), while downstream mail and share-link authorization keys on the email local-part only.

**Trace**

- entrypoint: `apps/api/src/modules/m01-auth/auth.controller.ts:83` (AuthController.oidcCallback) — Public GET /auth/oidc/callback receives code and state from the IdP redirect. Cookie state, one-time DB state and PKCE are checked at lines 87-89.
- propagation: `apps/api/src/modules/m01-auth/oidc.service.ts:70` (OidcService.validateIdToken) — After the signature, iss, aud, exp, iat and nonce checks, it requires only that sub and email are present. The email domain is not checked.
- propagation: `apps/api/src/modules/m01-auth/auth.controller.ts:97` (AuthController.oidcCallback) — companyDomain is used only to load the Company row and is never compared with claims.email.
- propagation: `apps/api/src/modules/m01-auth/auth.controller.ts:112` (AuthController.oidcCallback) — The collision check matches the exact full email only, so alice@other.example passes when alice@vcprosperous.com exists.
- propagation: `apps/api/src/modules/m01-auth/auth.controller.ts:113` (AuthController.oidcCallback) — Creates a company User with the foreign-domain email and roles derived from IdP groups.
- propagation: `apps/api/src/modules/m01-auth/auth.controller.ts:124` (AuthController.oidcCallback) — On the existing-binding path, User.email is overwritten with any verified token email (trustedEmail, line 123), again without a domain check.
- propagation: `apps/api/src/common/auth.guard.ts:58` (AuthGuard.canActivate) — ctx.user.email is taken from the stored User.email.
- sink: `apps/api/src/modules/mail-basic/mail-basic.service.ts:19` (MailBasicService.owner) — The mailbox owner is the local-part of ctx.user.email plus @vcworkspace.test. readableMailbox, sendingIdentity, drafts, filters and the shared-mailbox ACL (line 23) all use it, so the foreign-domain user maps to the victim's mailbox.

**Evidence**

- `apps/api/src/modules/m01-auth/auth.controller.ts:101` — email = claims.email.toLowerCase(), and no domain validation follows.
- `apps/api/src/modules/m01-auth/auth.controller.ts:157` — The sibling Google callback enforces claims.hd === domain and email.endsWith('@'+domain), showing the intended invariant.
- `apps/api/src/db/models.ts:39` — The unique index is on (companyId, full email), not on the local-part.
- `apps/api/src/modules/workspace-interop/workspace-interop.service.ts:76` — The share-link download check derives the caller's recipient address from the email local-part only.
- `apps/api/src/modules/workspace-interop/workspace-interop.service.ts:52` — assertRecipientsCanRead looks up a user with the regex ^local@ and any domain, so when local-parts collide it can resolve to either user.
- `apps/api/src/modules/mail-basic/mail-basic.service.ts:26` — syncFolder passes the local-part-derived owner as the engine access identity, so the engine-side mailbox is the shared one too.
- `apps/api/test/oidc-auth.e2e-spec.ts:87` — The existing OIDC tests exercise only company-domain emails, including the rename case. No foreign-domain case is covered.

**Blockers**

- IdP policy is outside the repository: whether Authentik lets a non-employee self-enroll into the VCworkspace application, or lets an employee change their own email, while issuing email_verified=true for a non-company domain.
- Target-controlled execution is blocked in this run: the macOS host cannot OS-enforce memory, process-count or disk limits, and no local Node container image exists. So the Jest harness was not run and no bounded local reproduction exists.

**Resolution plan**

- Local (bounded fixture): In a new case in apps/api/test/oidc-auth.e2e-spec.ts, use the same harness: createTestApp from apps/api/test/support/app.ts with authMode 'oidc', companyDomain 'vcprosperous.com' and the existing mocked fetch/JWKS. Sign an ID token for sub 'outsider' with email 'nv.mkt@other.example' and email_verified true, then complete /api/v1/auth/oidc/callback. Expected today: a 302 to the webOrigin returnTo, a new User with email nv.mkt@other.example, and GET /api/v1/mail/messages (fake mail port) querying mailboxOwner nv.mkt@vcworkspace.test, the same mailbox as the seeded nv.mkt@vcprosperous.com user. Second case: log in the existing binding 'subject-manager' with email 'nv.mkt@other.example' and assert that User.email is rewritten. After the fix (reject on both paths when !email.endsWith('@'+cfg.oidc.companyDomain)), both cases should redirect to /dang-nhap?loi=identity (or loi=domain) and create or modify no User.
- Owner-observed: The owner checks in the Authentik admin UI, without sending audit traffic to the app: whether any enrollment flow is bound to the VCworkspace application's brand or flow, whether users may edit their own email in user settings, and what the email scope mapping returns for email_verified. Then, using a read-only Mongo query or the admin UI, confirm whether any existing User in the company has an email outside the company domain.

## 8. External-document import fetches user URLs with redirects followed and no destination restriction

Fingerprint: `m04-documents/external-import/url-fetch-redirect-ssrf`

POST /external-documents (roles R1-R6, R8) accepts a url that must only start with https:// (contract format: uri). The background job calls google.urls.fetch, which re-checks the https protocol on the initial URL only. It then calls fetch with redirect:'follow' and no host, resolved-IP, private-range or per-hop scheme check. An https URL can name an internal host directly, or an attacker's https server can redirect to http:// internal services. Candidates are the compose-internal web:3000 and api:4000, or any other host the API container can reach, including metadata endpoints that need no special header. A successful (2xx) response body of up to 100 MB is uploaded into the chosen department's Drive EXT folder and registered as an effective EXT document. The job result returns the fileId. Failed fetches put the hostname and HTTP status into the job step error, which can also act as an internal reachability oracle. departmentId only has to exist in the company. Whether the requester can then open the uploaded file depends on Drive and AccessService permissions for that department, and what is reachable depends on deployed egress.

**Claimed root cause.** RealGoogle urls.fetch (real-google.ts:409-425) uses redirect:'follow' and validates only u.protocol of the user-supplied URL. It has no allowlist or resolved-address check for the initial target or any redirect hop, and the controller (documents.controller.ts:541) adds only an https-prefix check.

**Trace**

- entrypoint: `apps/api/src/modules/m04-documents/documents.controller.ts:537` (DocumentsController.importExternal) — An authenticated R1-R6/R8 user posts {url, departmentId, ...}. Only /^https:\/\//i is checked (:541) before the job is enqueued with the raw body (:544).
- propagation: `apps/api/src/modules/m04-documents/documents.controller.ts:556` (DocumentsController.runImportExternal) — The job step calls this.google.urls.fetch(p.url) with the stored body url
- propagation: `apps/api/src/google/real/real-google.ts:415` (RealGoogle.urls.fetch) — fetch(u, {redirect:'follow'}) follows redirects to any http(s) host without revalidating them
- sink: `apps/api/src/modules/m04-documents/documents.controller.ts:557` (DocumentsController.runImportExternal) — The fetched bytes are uploaded to the department Drive EXT folder and recorded as an effective EXT document (:561-575)

**Evidence**

- `apps/api/src/google/real/real-google.ts:411` — The protocol check runs on the initial URL only
- `apps/api/src/google/real/real-google.ts:416` — A non-2xx response throws an error containing the hostname and status, which is stored as the job step error (jobs.service.ts:145)
- `apps/api/src/modules/m04-documents/documents.controller.ts:541` — The controller validates only the https prefix. departmentId must exist (:539-540) but is not checked against the caller's department.
- `apps/api/src/modules/m04-documents/documents.controller.ts:22` — R6_UP = R1, R2, R3, R4, R5, R6, R8

**Blockers**

- Target-controlled execution is blocked in this run: the host cannot OS-enforce memory, process and disk limits, and the real adapter would need outbound networking, which is prohibited. The fake adapter makes no request.
- Deployed egress policy and which internal services and metadata endpoints the API container can reach (the network in deploy/docker-compose.prod.yml, cloud metadata header requirements, any egress proxy) are not visible in the source and decide the impact

**Resolution plan**

- Local (bounded fixture): Unit-test RealGoogle urls.fetch against loopback fixtures only. Run an https fixture server whose self-signed certificate is trusted only via the test's NODE_EXTRA_CA_CERTS. It returns 302 to http://127.0.0.1:<port>/internal, which a second loopback fixture serves with a marker body. Expect the marker body to be returned. Also call fetch with https://127.0.0.1:<port>/ directly. Regression fix: resolve the host and reject loopback, private, link-local and internal hostnames for the initial URL and every hop, handle redirects manually with a capped hop count and https on every hop, and pin the connection to the validated address.
- Owner-observed: The owner checks from inside the deployed API container which internal hosts and ports (web:3000, api:4000, mongo, any Nextcloud/ONLYOFFICE/Stalwart hosts) and which cloud metadata endpoints can be reached without special headers. The owner also checks whether an egress proxy or firewall restricts outbound fetches. No audit traffic is sent to the deployment.

## 9. IMAP client finds response boundaries by regex instead of the literal byte count

Fingerprint: `mail-basic/imap-literal-length-ignored`

The hand-written IMAP client in StalwartMailPort ends a response at the first line anywhere in the buffer that starts with the expected tag (for example /^s5 OK/m), including lines inside message literals. It then slices message bytes between 'BODY[] {' and the last '\r\n<tag> OK'. Tags are predictable (s3, s4, ... in listFolder; a3/a4 in uid()/raw()). Suppose a raw message body contains a line starting with the next tag plus ' OK'. Its read ends early and the message is truncated. The rest of the stream is then handed to the next tagged read, where a forged 'BODY[] {' section and Message-ID inside that rest can be taken as the next message's bytes and engineId. In uid() a lazy regex lets a message with no Message-ID take the UID of the next message's Message-ID, so raw() and setLabels() can act on the wrong UID. All of this stays inside the mailbox being synced; the effect is attribution and integrity confusion, not cross-mailbox disclosure. Mail built by the API is base64-encoded, so impact depends on whether other raw mail reaches the mailboxes.

**Claimed root cause.** raw(), uid() and listFolder() in stalwart-mail.port.ts never use the IMAP {N} literal length. Completion, message slicing, UID-to-Message-ID mapping and the engine key all come from regexes and indexOf over the whole response, including literal content (tls-client.ts read()).

**Trace**

- entrypoint: `apps/api/src/modules/mail-basic/mail-basic.service.ts:26` (MailBasicService.syncFolder) — Mailbox listing calls mail.listFolder and stores one row per returned engineId
- propagation: `apps/api/src/modules/mail-basic/tls-client.ts:7` (tlsConnect.read) — Resolves on the first regex match in the latin1 buffer since the cursor and moves the cursor there; literal lengths are ignored
- propagation: `apps/api/src/modules/mail-basic/stalwart-mail.port.ts:52` (StalwartMailPort.uid) — Ends at /^a3 OK/m, then maps UID to Message-ID with a lazy [\s\S]*? regex that can span FETCH responses when a message has no Message-ID
- sink: `apps/api/src/modules/mail-basic/stalwart-mail.port.ts:92` (StalwartMailPort.listFolder) — Each FETCH read ends at /^sN OK/m. The message bytes are the slice from the first 'BODY[] {' to lastIndexOf('\r\nsN OK'), and engineId is the first Message-ID line found by regex in that slice

**Evidence**

- `apps/api/src/modules/mail-basic/stalwart-mail.port.ts:48` — raw() uses the same /^a4 OK/m completion, 'BODY[] {' marker and lastIndexOf slicing
- `apps/api/src/modules/mail-basic/mail-basic.service.ts:25` — Stored metadata comes from mailparser (simpleParser), a different parser from the regex that produces the engineId key
- `apps/api/src/config/config.ts:258` — The Stalwart engine host must be loopback, and Stalwart is not part of deploy/docker-compose.prod.yml, so the production mail ingress path is not visible in the source

**Blockers**

- Whether the deployed mail engine accepts inbound internet mail, or authenticated SMTP from anything other than the API, into these mailboxes, and whether it adds a Message-ID when one is missing, is deployment and engine behaviour that is not visible in the source
- Target-controlled execution is blocked in this run: the macOS host cannot OS-enforce memory, process-count and disk limits, and no local Node container image exists

**Resolution plan**

- Local (bounded fixture): Write a unit test that stubs tlsConnect with an in-memory duplex that replays fixed IMAP transcripts. (1) A listFolder transcript where UID 1's BODY[] literal contains the line 's4 OK done' followed by a forged 'BODY[] {10}' section with 'Message-ID: <victim@x>', then the real FETCH for UID 2. (2) A uid() transcript where message 1 has no Message-ID header. Compare the returned items, UIDs and engineIds with the expected split by literal length. Regression fix: parse literals by their declared {N} byte count (or use a maintained IMAP client library), match tagged completions only outside literals, and take the engine key from the same parser as the stored metadata.
- Owner-observed: The owner confirms whether the production mail engine accepts inbound internet SMTP, or authenticated SMTP or IMAP APPEND from clients other than the API, for @vcworkspace.test mailboxes, and how it handles missing Message-ID headers. No audit traffic is sent to the deployment.

## 10. Mailbox ownership is derived from the email local-part, not a bound account identity

Fingerprint: `mail-basic/mailbox-owner-local-part`

Mail-basic and workspace-interop pick a user's mailbox, shared-mailbox membership and engine credential from the part of the app email before '@', with @vcworkspace.test appended. User emails are unique only as full strings ({companyId,email}). In OIDC mode the callback uses OIDC_COMPANY_DOMAIN only to find the company. It never checks that the claimed email belongs to that domain. First login creates a user from any verified email that is not already an exact match, and every later verified login overwrites the stored email from the IdP claim. So two accounts in one company whose emails share a local-part but differ in domain (for example alice@vcworkspace.test and alice@other.example) resolve to the same mailbox owner. The owner match in shared() skips all ACL checks, so the second account gets the first account's personal mailbox: listing and syncing it, its drafts, sending as it, and the engine credential configured for it. Shared-mailbox membership and interop share-link recipient binding use the same mapping. Whether such an email can reach the app depends on IdP email policy.

**Claimed root cause.** MailBasicService.owner() (mail-basic.service.ts:19) and the interop recipient mapping (workspace-interop.service.ts:76) use ctx.user.email.split('@')[0] + '@vcworkspace.test' as the mailbox key. That key is not bound to a provisioned, unique mailbox record, and the OIDC login path does not require one allowed email domain.

**Trace**

- entrypoint: `apps/api/src/modules/m01-auth/auth.controller.ts:124` (AuthController.oidcCallback) — On each OIDC login the stored user email is set from the verified IdP email claim. The only domain use is the company lookup by cfg.oidc.companyDomain (:97); the email's own domain is never checked.
- propagation: `apps/api/src/modules/mail-basic/mail-basic.service.ts:19` (MailBasicService.owner) — Mailbox address = email local-part + @vcworkspace.test, lowercased
- propagation: `apps/api/src/modules/mail-basic/mail-basic.service.ts:23` (MailBasicService.shared) — If the requested address equals the derived owner, it returns null with no ACL check. Shared-mailbox membership is also matched on the derived owner address.
- sink: `apps/api/src/modules/mail-basic/stalwart-mail.port.ts:28` (StalwartMailPort.credential) — The IMAP/SMTP/Sieve engine credential is looked up by the derived owner address (used by imap() :51 and deliver() :32)

**Evidence**

- `apps/api/src/db/models.ts:39` — The unique index is {companyId, email} on the full email, not on the derived mailbox
- `apps/api/src/modules/m01-auth/auth.controller.ts:113` — A first OIDC login auto-creates a user from any email_verified email that is not already an exact match (:110-113); there is no domain check
- `apps/api/src/modules/m01-auth/oidc.service.ts:70` — ID-token validation requires only that sub and email are present; it applies no email-domain constraint
- `apps/api/src/modules/workspace-interop/workspace-interop.service.ts:76` — Share-link recipient binding uses the same local-part mapping
- `apps/api/src/modules/mail-basic/mail-basic.service.ts:29` — assertAddressFree compares derived local-part addresses of existing users only when an alias or shared mailbox is created; nothing checks again when a user is created or their email changes later

**Blockers**

- Whether the production Authentik lets users set or change their own email, which email domains it issues, and whether it asserts email_verified for them is deployment IdP configuration that is not visible in the source
- Target-controlled execution is blocked in this run: the macOS host cannot OS-enforce memory, process-count and disk limits, and no local Node container image exists

**Resolution plan**

- Local (bounded fixture): In the existing Jest harness (apps/api/test/support/app.ts) with the fake mail port and fake OIDC, seed one company and user A with alice@vcworkspace.test. Seed message rows for mailboxOwner alice@vcworkspace.test. Complete an OIDC callback for a new subject with email alice@other.example and email_verified=true. Assert whether the new user is created and whether GET /mail/messages for that session returns A's messages (mailboxOwner alice@vcworkspace.test). Regression fix: bind each user to a unique provisioned mailbox record, or reject OIDC emails outside the company domain and reject local-part collisions at user creation and email update.
- Owner-observed: The owner checks in the Authentik admin UI whether users can edit their own email attribute, which domains are allowed, and whether the email scope mapping emits email_verified=true. The owner also lists existing app users whose email local-parts collide across domains. No audit traffic is sent to the deployment.

## 11. Any signed-in user can claim any unused internal address as an alias or shared mailbox, which can later capture a new user's mail and send identity

Fingerprint: `mail-basic/self-service-address-claim`

POST /mail/aliases and POST /mail/shared-mailboxes require only a session and CSRF: there is no @Roles, no reserved-name policy and no admin approval. The OpenAPI contract describes an alias as a send identity for the user themself, yet any local-part that passes normalize() is accepted. assertAddressFree checks only current users' local-parts, existing aliases and existing shared mailboxes at creation time. No user-provisioning path checks aliases or shared mailboxes: the OIDC callback, Google first login and google-sync all use User.create without that check. So user A can pre-claim a future employee's address, or a role address such as hr@ or ketoan@. Afterwards sendingIdentity lets A send From that address. When a user with that local-part is provisioned later, send() indexes inbound copies for that recipient under the alias owner, because recipientMailbox prefers an active alias over the personal mailbox. A shared mailbox claim makes the address its own mailbox that A manages. Whether the mail engine also delivers to the new user's own account depends on Stalwart alias resolution, which is outside the source. This overlaps open item O4 in docs/ke-hoach/vcworkspace-review-qa-2026-10-25.md.

**Claimed root cause.** createAlias and createSharedMailbox rely on assertAddressFree at creation time only, with no role check, reserved-name or entitlement policy. User provisioning never reconciles against existing aliases or shared mailboxes, and recipientMailbox gives an alias precedence over a personal mailbox.

**Trace**

- entrypoint: `apps/api/src/modules/mail-basic/mail-basic.controller.ts:35` (MailBasicController.createAlias) — POST /mail/aliases needs only a session (no @Roles; compare the offboarding route at line 39, which has @Roles('R3','R9')). The shared-mailbox route at line 37 is the same.
- propagation: `apps/api/src/modules/mail-basic/mail-basic.service.ts:96` (MailBasicService.createAlias) — Any normalized @vcworkspace.test address is provisioned at the engine and stored as an active alias of the caller after assertAddressFree.
- propagation: `apps/api/src/modules/mail-basic/mail-basic.service.ts:27` (MailBasicService.assertAddressFree) — Checks only current users, aliases and shared mailboxes at that moment.
- propagation: `apps/api/src/modules/mail-basic/mail-basic.service.ts:39` (MailBasicService.sendingIdentity) — An active alias owned by the caller authorises sending From that address.
- sink: `apps/api/src/modules/mail-basic/mail-basic.service.ts:40` (MailBasicService.recipientMailbox) — An active alias match routes the recipient's app index row (mailboxOwner, engineMailbox, filterOwner) to the alias owner before the personal-mailbox fallback. send() applies this at line 78.

**Evidence**

- `apps/api/src/modules/mail-basic/mail-basic.service.ts:98` — Shared-mailbox creation is equally self-service and makes the caller a member of the new address.
- `apps/api/src/modules/m01-auth/auth.controller.ts:113` — OIDC user creation checks only exact User email existence (line 112), not existing aliases or shared addresses. The same applies at the Google path (line 174) and google-sync.service.ts:143.
- `apps/api/src/modules/mail-basic/mail-basic.service.ts:18` — normalize() accepts any [a-z0-9._%+-]+@vcworkspace.test local-part, with no reserved-name list.
- `contract/openapi.yaml:1886` — The contract states that an alias is a send identity created for the user themself, without defining any naming or entitlement policy.

**Blockers**

- Whether Stalwart delivers to the newly provisioned user's own account, or only to the alias owner, when an alias already holds the address is mail-engine behaviour outside the source. It decides whether the new user loses inbound mail at the engine level or only in the app index.
- Target-controlled execution is blocked in this run: the host cannot OS-enforce memory, process-count or disk limits, and no local Node container image exists. So the Jest harness was not run.

**Resolution plan**

- Local (bounded fixture): With createTestApp (apps/api/test/support/app.ts) and the fake mail port: as seeded user A, POST /api/v1/mail/aliases {address:'newhire@vcworkspace.test'} with CSRF and an Idempotency-Key, and expect 201. Then insert User newhire@vcprosperous.com in the test company, as a provisioning path would. As user B, POST /api/v1/mail/send to ['newhire@vcworkspace.test']. Assert which mailboxOwner the inbound WorkspaceMailMessage row has: today the expected value is A's owner address. Then, as A, send with fromIdentity 'newhire@vcworkspace.test' and expect the From to be accepted. Fix: restrict alias and shared-mailbox creation to an admin role or approved names, and reject (or flag for reconciliation) user provisioning when the derived address is already held.
- Owner-observed: The owner reviews the existing WorkspaceMailAlias and WorkspaceSharedMailbox addresses against the current and planned staff list and role addresses, using the admin UI or a read-only query.

## 12. Editor page fileId path injection can load an attacker-chosen script origin

Fingerprint: `web/bo-nho-soan-thao:fileId-path-injection-editor-config-script-src`

/bo-nho/soan-thao/[fileId] interpolates the route param, unencoded, into fetch(`/api/v1/drive/files/${fileId}/editor-config`) with the victim's same-origin cookie. It then appends <script src=`${payload.documentServerUrl}/web-apps/apps/api/documents/api.js`> without checking the origin. Prerequisite: the attacker must be a manager of a Drive space the victim is a member of, typically a department space with an R4 head (or a stale manager row), because upload requires assertManager. The attacker uploads a file whose bytes are JSON such as {"documentServerUrl":"https://attacker.example","config":{}}, labelled text/plain or application/octet-stream, both of which the upload allowlist accepts. The attacker then sends the victim /bo-nho/soan-thao/<fileId>%2Fcontent%23. If the Next.js client delivers the decoded param '<fileId>/content#', the fetch becomes GET /api/v1/drive/files/<fileId>/content, because the browser drops everything after '#' from the request. That endpoint returns the stored bytes for any space member. response.json() ignores the Content-Type and Content-Disposition, so the page loads the attacker's script in the VCworkspace web origin. Caddy and Next set no Content-Security-Policy, and no middleware exists, so the script would run with the victim's session: it could read /me and the CSRF value and perform API actions as the victim.

**Claimed root cause.** The client builds an API path from an unvalidated route param without encodeURIComponent or an id format check (apps/web/src/app/(app)/bo-nho/soan-thao/[fileId]/page.tsx:16-17). It then trusts the parsed response as the source of a script origin (:21) with no allowlist and no CSP.

**Trace**

- entrypoint: `apps/web/src/app/(app)/bo-nho/soan-thao/[fileId]/page.tsx:16` (DocumentEditorPage effect) — fileId is taken from the route params of an attacker-supplied link.
- propagation: `apps/web/src/app/(app)/bo-nho/soan-thao/[fileId]/page.tsx:17` (DocumentEditorPage effect) — fetch(`${API_BASE}/drive/files/${fileId}/editor-config`) runs with the param unencoded and credentials 'same-origin'. API_BASE is '/api/v1' (apps/web/src/api/client.ts:30).
- propagation: `apps/api/src/modules/drive-basic/drive-basic.controller.ts:43` (DriveBasicController.content) — GET drive/files/:fileId/content returns the stored bytes verbatim to any member of the file's space, with the stored mimeType and Content-Disposition attachment.
- propagation: `apps/web/src/app/(app)/bo-nho/soan-thao/[fileId]/page.tsx:19` (DocumentEditorPage effect) — response.json() parses the body whatever its Content-Type.
- sink: `apps/web/src/app/(app)/bo-nho/soan-thao/[fileId]/page.tsx:21` (DocumentEditorPage effect) — script.src is set to payload.documentServerUrl plus a fixed path, and the script is appended to document.head at line 35.

**Evidence**

- `deploy/Caddyfile:7` — The header block sets HSTS, nosniff and Referrer-Policy but no Content-Security-Policy. No CSP is set anywhere in apps/web/src, apps/api/src or deploy.
- `apps/web/next.config.ts:11` — No headers() and no CSP are configured in Next. There is no middleware.ts.
- `apps/api/src/modules/drive-basic/drive-basic.service.ts:134` — Upload accepts the client-declared mimetypes text/plain and application/octet-stream, so arbitrary JSON bytes can be stored. Upload requires a manager role (:131).
- `apps/api/src/modules/drive-basic/drive-basic.service.ts:429` — The legitimate documentServerUrl comes from server config. The client never checks it against an allowlist.

**Blockers**

- Whether Next.js 15.5.28 app-router page params decode %2F and %23 inside a single dynamic segment, both on the initial load and after client-side navigation, is renderer and runtime behavior that needs a local browser test.
- Local browser and target execution is blocked in this run: the host cannot OS-enforce resource limits.
- Whether an upstream proxy in the deployment adds a Content-Security-Policy restricting script-src is outside source.

**Resolution plan**

- Local (bounded fixture): With the local dev stack, dummy accounts and fake Google: dummy user A is manager (R4) of department space D, and dummy user B is a reader member of D. As A, upload a text/plain file whose bytes are {"documentServerUrl":"http://127.0.0.1:<fixture-port>","mode":"view","config":{}}. The loopback fixture serves /web-apps/apps/api/documents/api.js containing only window.__pwn=1. As B, open /bo-nho/soan-thao/<fileId>%2Fcontent%23. In the network panel, check whether the API request goes to /api/v1/drive/files/<fileId>/content and whether the fixture script loads, then check window.__pwn. Repeat with %3F instead of %23. Regression: encodeURIComponent(fileId) plus a 24-hex ObjectId format check, and an origin allowlist for documentServerUrl, must each prevent the load.
- Owner-observed: The owner checks the deployed web origin's response headers, from their own browser on a normal page load, for a Content-Security-Policy that restricts script-src to self and the Document Server origin.
