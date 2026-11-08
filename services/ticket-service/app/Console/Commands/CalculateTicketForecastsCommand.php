<?php

namespace App\Console\Commands;

use App\Services\TicketForecastService;
use Illuminate\Console\Command;

class CalculateTicketForecastsCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'tickets:calculate-forecasts {--horizon=7 : Number of future days to project}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Precompute daily ticket volume forecasts and recurring issue trends per branch';

    /**
     * Execute the console command.
     */
    public function handle(TicketForecastService $forecastService): int
    {
        $horizon = (int) $this->option('horizon');
        $this->info("Calculating ticket volume forecasts (horizon: {$horizon} days)...");

        try {
            $results = $forecastService->calculateAndPersistAllBranches($horizon);
            $this->info("Forecast calculation completed successfully for " . count($results) . " branch(es).");
            return Command::SUCCESS;
        } catch (\Throwable $e) {
            $this->error("Forecast calculation failed: " . $e->getMessage());
            return Command::FAILURE;
        }
    }
}

