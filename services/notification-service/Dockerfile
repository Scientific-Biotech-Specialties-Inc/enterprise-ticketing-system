FROM php:8.2-fpm

WORKDIR /var/www

RUN apt-get update && apt-get install -y \
    git curl zip unzip libpng-dev libonig-dev libxml2-dev libzip-dev

RUN docker-php-ext-install pdo pdo_mysql zip pcntl opcache
RUN pecl install redis && docker-php-ext-enable redis

# Configure OPcache
RUN echo "opcache.enable=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.memory_consumption=128" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.interned_strings_buffer=8" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.max_accelerated_files=10000" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.validate_timestamps=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.revalidate_freq=2" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.fast_shutdown=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "variables_order=EGPCS" >> /usr/local/etc/php/conf.d/opcache.ini

RUN printf '<?php\ntry {\n  $h = getenv("DB_HOST");\n  if ($h) {\n    $p = getenv("DB_PORT") ?: "3306";\n    $d = getenv("DB_DATABASE") ?: "ticketing_prod";\n    $u = getenv("DB_USERNAME") ?: "root";\n    $w = (string)getenv("DB_PASSWORD");\n    $pdo = new PDO("mysql:host=$h;port=$p", $u, $w, [PDO::ATTR_TIMEOUT => 5]);\n    $pdo->exec("CREATE DATABASE IF NOT EXISTS `$d` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");\n  }\n} catch (Throwable $e) {\n  fwrite(STDERR, "DB init note: " . $e->getMessage() . "\\n");\n}\n' > /usr/local/bin/init-db.php

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY . .

# Run composer install at build time
RUN mkdir -p bootstrap/cache storage && composer install --no-interaction --no-dev --prefer-dist --optimize-autoloader

CMD sh -lc "if [ ! -f .env ] && [ -f .env.example ]; then cp .env.example .env; fi && if grep -q '^APP_KEY=$' .env; then php artisan key:generate --force; fi && php /usr/local/bin/init-db.php && (php artisan migrate --force || true) && php -d variables_order=EGPCS artisan serve --no-reload --host=0.0.0.0 --port=8000"
