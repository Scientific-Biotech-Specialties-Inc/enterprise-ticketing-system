#!/bin/bash
# Production optimization helper script for Laravel Services
# Caches configuration, routes, and views inside running containers to improve performance.

echo "======================================================"
echo " Starting Production Caching & Performance Tuning"
echo "======================================================"

SERVICES=(
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

for SERVICE in "${SERVICES[@]}"; do
    echo "------------------------------------------------------"
    echo "Tuning performance for: $SERVICE"
    echo "------------------------------------------------------"
    
    # Check if container is running
    if [ "$(docker inspect -f '{{.State.Running}}' "$SERVICE" 2>/dev/null)" = "true" ]; then
        echo "=> Clearing old cache..."
        docker exec -i "$SERVICE" php artisan config:clear
        docker exec -i "$SERVICE" php artisan route:clear
        docker exec -i "$SERVICE" php artisan view:clear
        
        echo "=> Caching config files..."
        docker exec -i "$SERVICE" php artisan config:cache
        
        echo "=> Caching routes files..."
        docker exec -i "$SERVICE" php artisan route:cache
        
        echo "=> Caching blade views..."
        docker exec -i "$SERVICE" php artisan view:cache
        
        echo "=> Optimized successfully!"
    else
        echo "WARNING: Container '$SERVICE' is not running. Skipping optimization."
    fi
done

echo "======================================================"
echo " Production caching optimization complete!"
echo "======================================================"
