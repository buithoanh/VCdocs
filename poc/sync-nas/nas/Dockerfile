# Chat15 simulated NAS: Samba on the official Alpine image pinned by digest.
# Only reachable on the internal Docker network of the work13 stack (no port is
# published on the host). Accounts and passwords come from mounted secret files
# at start-up (see entrypoint.sh); nothing secret is baked into the image.
FROM alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412
RUN apk add --no-cache samba-server samba-common-tools samba-client tini \
 && rm -f /etc/samba/smb.conf
COPY smb.conf /etc/samba/smb.conf
COPY entrypoint.sh /usr/local/bin/nas-entrypoint.sh
RUN chmod 0755 /usr/local/bin/nas-entrypoint.sh && testparm -s /etc/samba/smb.conf >/dev/null
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/nas-entrypoint.sh"]
