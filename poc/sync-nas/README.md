# Sync + NAS PoC (chat 15)

Chạy trên stack chat13 `vcworkspace-work13` (Nextcloud 33.0.10 + Authentik, chỉ bind
`127.0.0.1`) và overlay Flow chat14. Dữ liệu và tài khoản giả; không Google thật, email
thật, thiết bị thật hay cài app lên máy Mac. Bàn giao:
`docs/ke-hoach/vcworkspace-15-ban-giao-sync-nas.md`.

| Thành phần | Ở đâu | Ghi chú |
|---|---|---|
| `nas15` | container `vcworkspace-sync15`, mạng `work13` (internal), **không** publish cổng | Samba 4.21.9 trên `alpine@sha256:4b7ce070…` (3.22.2), volume mới `vcworkspace_sync15_nas`, share `team-a`/`team-b` theo nhóm Unix |
| `smb-client` | cùng mạng | smbclient để "sửa trực tiếp trên NAS" và ma trận deny SMB; auth file chỉ đọc |
| `files-notify` | cùng mạng, image `nextcloud-smb` | `occ files_external:notify -v 1` cho mount Team A |
| `nextcloud` work13 | tạo lại bằng `compose.work13-nc-smb.override.yaml` | cùng digest 33.0.10 + `smbclient` 4.22.11 + php-smbclient 1.1.1 (`nextcloud-smb/Dockerfile`) |
| Restore | `compose.restore.yaml`, project `vcworkspace-sync15-restore`, cổng `127.0.0.1:18153` | volume riêng `vcworkspace_sync15_restore_*` |

Secret: `WORK13_SECRETS_DIR` trỏ `secrets/` (Git bỏ qua) của stack chat13. Mật khẩu NAS,
auth file smbclient và app password "thiết bị" sinh vào `poc/sync-nas/secrets/` (0600, Git
bỏ qua). Không in giá trị. Script receiver Flow dùng lại `poc/flow/` (MongoDB thử
`127.0.0.1:18141`, xem README chat14).

## Trình tự

```
export WORK13_SECRETS_DIR=<worktree chat13>/poc/work-management/secrets
docker build -t vcworkspace-sync15/nas:alpine3.22.2-1 nas
docker build --platform linux/arm64 -t vcworkspace-sync15/nextcloud-smb:33.0.10-1 nextcloud-smb
node create-secrets.mjs
docker compose -f compose.sync15.yaml up -d nas15 smb-client
docker compose -p vcworkspace-work13 --project-directory <chat13>/poc/work-management \
  -f <chat13>/poc/work-management/compose.yaml -f compose.work13-nc-smb.override.yaml up -d --no-deps nextcloud
node setup-nas-mounts.mjs            # 2 mount SMB theo nhóm + case_sensitive=false, encoding_compatibility=true
SYNC15_NOTIFY_MOUNT_ID=1 docker compose -f compose.sync15.yaml up -d files-notify
node acceptance-nas-acl.mjs          # ACL WebDAV + SMB trực tiếp
node probe-detection.mjs             # độ trễ thấy thay đổi trên NAS (notify bật/tắt, SMB/filesystem, burst)
node acceptance-nas-changes.mjs      # rename/metadata, Unicode, hoa/thường
node repro-case-unicode.mjs          # repro mất file khi đổi tên chỉ khác hoa/thường + NFD
SYNC15_LARGE_MIB=1024 node acceptance-nas-large.mjs
node acceptance-sync-webdav.mjs      # ngữ nghĩa sync: ETag/If-Match, chunked v2, xung đột, revoke, offboard
node acceptance-nas-flow.mjs         # cần mongod 18141; receiver chat14 + đối soát Files chat15
node restart-sync15.mjs && SYNC15_ACL_LABEL=acceptance-nas-acl-after-restart node acceptance-nas-acl.mjs
node backup-sync15.mjs && node restore-sync15.mjs && node verify-restore-sync15.mjs
node measure-scan.mjs && node environment.mjs && node scan-secrets.mjs
```

`debug-*.mjs` chỉ để dò lỗi (listing, If-Match, khoá file, PUT đồng thời).

## Ghi chú vận hành

- Nếu chạy lại `docker compose up` của chat13 **không** kèm override, Nextcloud quay về image
  gốc không có smbclient → mount SMB báo lỗi (dữ liệu không mất).
- Webhook Flow sau chat15 dùng bí mật trong `poc/flow/secrets/` của worktree chat15; chạy
  `register-webhooks.mjs` lại từ worktree đang dùng.
- `restore-sync15.mjs` chỉ tạo/xoá volume `vcworkspace_sync15_restore_*` (xoá khi
  `SYNC15_RECREATE_RESTORE=1`); không đụng volume của chat khác.
