# Chat15: same Nextcloud 33.0.10 image digest as chat13/14 plus SMB support for
# External Storage: the smbclient binary (needed for `files_external:notify`)
# and the php-smbclient extension (libsmbclient, faster native backend).
# Build-only packages are removed again; no config or secret is added.
FROM nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends smbclient libsmbclient0 libsmbclient-dev $PHPIZE_DEPS; \
    pecl install smbclient-1.1.1; \
    docker-php-ext-enable smbclient; \
    apt-get purge -y --auto-remove libsmbclient-dev $PHPIZE_DEPS; \
    rm -rf /var/lib/apt/lists/* /tmp/pear; \
    php -m | grep -qx smbclient; \
    smbclient --version
