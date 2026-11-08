<?php

namespace App\Providers;

use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Listeners\SendEmailVerificationNotification;
use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\Event;

class EventServiceProvider extends ServiceProvider
{
    /**
     * The event to listener mappings for the application.
     *
     * @var array<class-string, array<int, class-string>>
     */
    protected $listen = [
        Registered::class => [
            SendEmailVerificationNotification::class,
        ],
    ];

    /**
     * Register any events for your application.
     */
    public function boot(): void
    {
        // Spec 0036: indexing happens inside the upload, edit, replace or reindex request, so
        // publish and update listeners only refresh caches. The events still broadcast on their own
        // (they implement ShouldBroadcastNow).
        Event::listen(\App\Events\ArticlePublished::class, function (\App\Events\ArticlePublished $event) {
            app(\App\Services\RagService::class)->refreshIndex($event->article->id);
        });

        Event::listen(\App\Events\ArticleArchived::class, function (\App\Events\ArticleArchived $event) {
            app(\App\Services\RagService::class)->refreshIndex($event->article->id);
            \App\Jobs\IndexKbArticleJob::dispatch($event->article->id, 'archive', $event->actor);
        });

        Event::listen(\App\Events\ArticleUpdated::class, function (\App\Events\ArticleUpdated $event) {
            app(\App\Services\RagService::class)->refreshIndex($event->article->id);
        });

        Event::listen(\App\Events\ArticleDeleted::class, function (\App\Events\ArticleDeleted $event) {
            \App\Jobs\IndexKbArticleJob::dispatch($event->articleId, 'delete', $event->actor);
        });
    }

    /**
     * Determine if events and listeners should be automatically discovered.
     */
    public function shouldDiscoverEvents(): bool
    {
        return false;
    }
}
