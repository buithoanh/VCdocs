#!/usr/bin/env bash
# Sao lưu Stalwart – chạy hằng đêm bằng cron trên máy chủ thư (deploy/mail/README.md mục 9):
#   1. dừng container (RocksDB không an toàn khi chép lúc đang chạy; hộp thư ngừng phục vụ trong lúc nén)
#   2. nén hai volume (cấu hình + dữ liệu) vào BACKUP_DIR, kèm tệp SHA-256
#   3. chạy lại container – kể cả khi bước nén lỗi
#   4. nếu có BACKUP_S3 thì đẩy bản vừa tạo lên S3
# Thư tới trong lúc dừng không mất: máy gửi tự thử lại sau.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=${ENV_FILE:-./.env}
set -a; source "$ENV_FILE"; set +a
: "${BACKUP_DIR:?Thiếu BACKUP_DIR trong $ENV_FILE}"

PROJECT=${COMPOSE_PROJECT_NAME:-vcmail}
IMAGE=${STALWART_IMAGE:-stalwartlabs/stalwart@sha256:c429b311c93db5606598abc1c68225a85a6953183848ae01bee9c6a98885836c}
KEEP=${BACKUP_KEEP:-7}
STAMP=$(date +%Y-%m-%d_%H%M%S)
compose() { docker compose --env-file "$ENV_FILE" "$@"; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$(date -Is)] dừng stalwart"
compose stop stalwart
trap 'echo "[$(date -Is)] chạy lại stalwart"; compose start stalwart' EXIT

for PART in etc data; do
  OUT="vcmail_${STAMP}_${PART}.tgz"
  echo "[$(date -Is)] nén volume ${PROJECT}_stalwart-${PART} → $BACKUP_DIR/$OUT"
  # Dùng chính image Stalwart để nén (có sẵn tar), không cần kéo thêm image; không mạng, volume chỉ đọc.
  docker run --rm --network none --user 0 --entrypoint tar \
    -v "${PROJECT}_stalwart-${PART}:/src:ro" -v "$BACKUP_DIR:/dst" \
    "$IMAGE" -czf "/dst/$OUT" -C /src .
done

trap - EXIT
echo "[$(date -Is)] chạy lại stalwart"
compose start stalwart

cd "$BACKUP_DIR"
chmod 600 "vcmail_${STAMP}_etc.tgz" "vcmail_${STAMP}_data.tgz"
sha256sum "vcmail_${STAMP}_etc.tgz" "vcmail_${STAMP}_data.tgz" > "vcmail_${STAMP}.sha256"

if [ -n "${BACKUP_S3:-}" ]; then
  echo "[$(date -Is)] tải lên $BACKUP_S3"
  for F in "vcmail_${STAMP}_etc.tgz" "vcmail_${STAMP}_data.tgz" "vcmail_${STAMP}.sha256"; do
    aws s3 cp --only-show-errors "$F" "${BACKUP_S3%/}/$F"
  done
fi

# Giữ KEEP bộ gần nhất trên đĩa máy (bản đầy đủ nằm trên S3 nếu đã bật)
ls -1t vcmail_*.sha256 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r OLD; do
  BASE=${OLD%.sha256}
  rm -f "$OLD" "${BASE}_etc.tgz" "${BASE}_data.tgz"
done

echo "[$(date -Is)] xong: vcmail_${STAMP}"
