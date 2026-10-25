<?php
declare(strict_types=1);

$configPath = '/var/www/html/config/config.php';
$secretPath = '/run/secrets/nc_db_password';
if (!is_file($configPath) || !is_file($secretPath)) {
    fwrite(STDERR, "Restore config or Docker secret is missing.\n");
    exit(1);
}
require $configPath;
if (!isset($CONFIG) || !is_array($CONFIG)) {
    fwrite(STDERR, "Nextcloud config is invalid.\n");
    exit(1);
}
$password = trim((string) file_get_contents($secretPath));
if ($password === '') {
    fwrite(STDERR, "Docker secret is empty.\n");
    exit(1);
}
$CONFIG['dbuser'] = 'nextcloud';
$CONFIG['dbpassword'] = $password;
$temporary = $configPath . '.restore-tmp';
$content = "<?php\n\$CONFIG = " . var_export($CONFIG, true) . ";\n";
if (file_put_contents($temporary, $content, LOCK_EX) === false || !rename($temporary, $configPath)) {
    fwrite(STDERR, "Unable to atomically update restored config.\n");
    exit(1);
}
chmod($configPath, 0640);
chown($configPath, 'www-data');
chgrp($configPath, 'www-data');
echo "Restored Nextcloud DB binding was updated without printing the credential.\n";
