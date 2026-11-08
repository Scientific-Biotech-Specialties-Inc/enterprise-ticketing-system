<?php

namespace App\Providers;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        try {
            $level = Cache::get('system:config:log_level');
            if ($level) {
                $norm = strtolower($level);
                config([
                    'logging.channels.single.level' => $norm,
                    'logging.channels.daily.level' => $norm,
                ]);
            }
        } catch (\Throwable $e) {}
    }
}
