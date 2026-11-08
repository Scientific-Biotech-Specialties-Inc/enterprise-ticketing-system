#!/bin/bash
# ==============================================================================
# Enterprise Ticketing System - Production Deployment Script
# Usage: ./deploy-prod.sh
# ==============================================================================
set -e

echo "=========================================================="
echo " Starting Enterprise Ticketing System Production Deployment"
echo "=========================================================="

# 1. Verify .env exists
if [ ! -f .env ]; then
    echo "ERROR: .env file not found!"
    echo "Please copy .env.production.example to .env and configure your secrets first."
    exit 1
fi

# 2. Build and start production containers
echo "=> Pulling base images & building containers..."
docker compose -f docker-compose.prod.yml up -d --build

# 3. Wait for database container to be healthy
echo "=> Waiting for MySQL database to be ready..."
until [ "`docker inspect -f {{.State.Health.Status}} capstone-db-prod 2>/dev/null`"=="healthy" ]; do
    echo "Database is initializing, waiting 5 seconds..."
    sleep 5
done

# 4. Run Laravel migrations across all microservices
echo "=> Executing database migrations..."
MIGRATION_SERVICES=(
    "customer-service-prod"
    "ticket-service-prod"
    "employee-service-prod"
    "configuration-service-prod"
    "attachment-service-prod"
    "notification-service-prod"
    "analytics-service-prod"
    "ai-service-prod"
    "messaging-service-prod"
)

for SERVICE in "${MIGRATION_SERVICES[@]}"; do
    echo "Running migrations for: $SERVICE..."
    docker exec -i "$SERVICE" php artisan migrate --force || true
done

# 5. Optimize production caches
if [ -f ./production-optimize.sh ]; then
    echo "=> Optimizing Laravel route, view, and config caches..."
    chmod +x ./production-optimize.sh
    ./production-optimize.sh
fi

echo "=========================================================="
echo " Production Deployment Completed Successfully!"
echo " Gateway running on Port 80 & 443"
echo "=========================================================="
