#!/bin/sh
set -e

# Default each service URL to local Docker Compose naming conventions if not provided
export TICKET_SERVICE_URL="${TICKET_SERVICE_URL:-http://ticket-service:8000}"
export EMPLOYEE_SERVICE_URL="${EMPLOYEE_SERVICE_URL:-http://employee-service:8000}"
export CUSTOMER_SERVICE_URL="${CUSTOMER_SERVICE_URL:-http://customer-service:8000}"
export CONFIGURATION_SERVICE_URL="${CONFIGURATION_SERVICE_URL:-http://configuration-service:8000}"
export ATTACHMENT_SERVICE_URL="${ATTACHMENT_SERVICE_URL:-http://attachment-service:8000}"
export MESSAGING_SERVICE_URL="${MESSAGING_SERVICE_URL:-http://messaging-service:8000}"
export ANALYTICS_SERVICE_URL="${ANALYTICS_SERVICE_URL:-http://analytics-service:8000}"
export NOTIFICATION_SERVICE_URL="${NOTIFICATION_SERVICE_URL:-http://notification-service:8000}"
export AI_SERVICE_URL="${AI_SERVICE_URL:-http://ai-service:8000}"

# Substitute only our defined service URLs into Nginx configuration (leaving $1, $args, $host untouched)
envsubst '$TICKET_SERVICE_URL $EMPLOYEE_SERVICE_URL $CUSTOMER_SERVICE_URL $CONFIGURATION_SERVICE_URL $ATTACHMENT_SERVICE_URL $MESSAGING_SERVICE_URL $ANALYTICS_SERVICE_URL $NOTIFICATION_SERVICE_URL $AI_SERVICE_URL' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"

