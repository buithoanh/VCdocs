#!/usr/bin/env bash
# Khôi phục Stalwart từ một bộ sao lưu của backup.sh vào hai volume CÒN TRỐNG.
#   ./khoi-phuc.sh 2026-11-14_020000
# Cố ý không ghi đè: nếu volume đích đã có dữ liệu thì dừng, không xoá gì. Muốn khôi phục đè lên máy
# đang chạy thì người vận hành tự dừng stack và xoá volume cũ sau khi đã chắc bản sao lưu dùng được.
# Diễn tập trên máy khác (hoặc project khác: COMPOSE_PROJECT_NAME=vcmail-dien-tap) trước khi cần thật.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=${ENV_FILE:-./.env}
set -a; source "$ENV_FILE"; set +a
: "${BACKUP_DIR:?Thiếu BACKUP_DIR trong $ENV_FILE}"
STAMP=${1:?Cách dùng: ./khoi-phuc.sh <mốc thời gian, ví dụ 2026-11-14_020000>}

PROJECT=${COMPOSE_PROJECT_NAME:-vcmail}
IMAGE=${STALWART_IMAGE:-stalwartlabs/stalwart@sha256:c429b311c93db5606598abc1c68225a85a6953183848ae01bee9c6a98885836c}

echo "[$(date -Is)] kiểm SHA-256 bộ vcmail_${STAMP}"
(cd "$BACKUP_DIR" && sha256sum -c "vcmail_${STAMP}.sha256")

for PART in etc data; do
  VOLUME="${PROJECT}_stalwart-${PART}"
  docker volume create "$VOLUME" > /dev/null
  COUNT=$(docker run --rm --network none --user 0 --entrypoint sh -v "$VOLUME:/dst:ro" "$IMAGE" -c 'ls -A /dst | wc -l')
  if [ "$COUNT" != "0" ]; then
    echo "DỪNG: volume $VOLUME đã có dữ liệu ($COUNT mục). Không ghi đè." >&2
    exit 1
  fi
done

for PART in etc data; do
  VOLUME="${PROJECT}_stalwart-${PART}"
  echo "[$(date -Is)] giải nén vcmail_${STAMP}_${PART}.tgz → $VOLUME"
  # Giữ nguyên chủ sở hữu tệp (người dùng stalwart trong container) nên giải nén bằng root.
  docker run --rm --network none --user 0 --entrypoint tar \
    -v "$VOLUME:/dst" -v "$BACKUP_DIR:/src:ro" \
    "$IMAGE" -xzf "/src/vcmail_${STAMP}_${PART}.tgz" -C /dst
done

echo "[$(date -Is)] xong. Chạy: docker compose up -d  rồi kiểm tra bằng kiem-tra-gui-nhan.mjs"
