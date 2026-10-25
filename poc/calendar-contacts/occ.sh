#!/bin/sh
# Chat16: run occ in the work13 Nextcloud as www-data (debug helper).
exec docker exec -u www-data "${CAL16_NC_CONTAINER:-vcworkspace-work13-nextcloud-1}" php occ --no-ansi --no-interaction "$@"
