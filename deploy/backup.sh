#!/usr/bin/env bash
# Sao lưu VCdocs lên Cloud Storage – chạy hằng đêm bằng cron trên máy chủ (deploy/README.md bước 10):
#   1. mongodump toàn bộ CSDL (nén) → BACKUP_BUCKET_DB/mongo/YYYY-MM-DD_HHMM.archive.gz
#   2. đồng bộ kho PDF đã chốt → BACKUP_BUCKET_VAULT/vault/ (chỉ thêm, không xoá bên bucket)
# Máy ảo cần quyền ghi vào 2 bucket (service account của VM, vai trò Storage Object Creator/User).
set -euo pipefail

cd "$(dirname "$0")"
set -a; source ./.env; set +a
: "${DATA_DIR:?}" "${MONGO_PASSWORD:?}" "${BACKUP_BUCKET_DB:?}" "${BACKUP_BUCKET_VAULT:?}"

STAMP=$(date +%Y-%m-%d_%H%M)
LOCAL_DIR="$DATA_DIR/backup"
DUMP="$LOCAL_DIR/mongo_$STAMP.archive.gz"
mkdir -p "$LOCAL_DIR"

echo "[$(date -Is)] mongodump → $DUMP"
docker compose -f docker-compose.prod.yml exec -T mongo \
  mongodump --quiet --archive --gzip \
  --username "${MONGO_USER:-vcdocs}" --password "$MONGO_PASSWORD" --authenticationDatabase admin \
  > "$DUMP"

echo "[$(date -Is)] tải bản dump lên $BACKUP_BUCKET_DB"
gcloud storage cp --quiet "$DUMP" "$BACKUP_BUCKET_DB/mongo/"

echo "[$(date -Is)] đồng bộ kho PDF lên $BACKUP_BUCKET_VAULT"
gcloud storage rsync --quiet --recursive "$DATA_DIR/vault" "$BACKUP_BUCKET_VAULT/vault"

# Giữ 7 bản dump gần nhất trên đĩa máy (bản đầy đủ nằm trên bucket)
ls -1t "$LOCAL_DIR"/mongo_*.archive.gz | tail -n +8 | xargs -r rm -f

echo "[$(date -Is)] xong"
