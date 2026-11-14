# Stage 1: Build the React application
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Declare build-time arguments for Vite environment variables
ARG VITE_API_URL=/api/ticketing/customer
ARG VITE_SANCTUM_URL=/api/ticketing/customer
ARG VITE_TICKET_API_URL=/api/ticketing/ticket
ARG VITE_REVERB_APP_KEY=local
ARG VITE_REVERB_HOST=localhost
ARG VITE_REVERB_PORT=6001
ARG VITE_BASE_PATH=/
ARG VITE_APP_MODE=customer
# Public URL of the customer portal. The employee build uses it to send customer accounts to their own
# portal. Empty keeps the localhost port fallback (5005 -> 5006) in WrongPortal/AuthContext.
ARG VITE_CUSTOMER_PORTAL_URL=

# Expose them to the build process
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SANCTUM_URL=$VITE_SANCTUM_URL
ENV VITE_TICKET_API_URL=$VITE_TICKET_API_URL
ENV VITE_REVERB_APP_KEY=$VITE_REVERB_APP_KEY
ENV VITE_REVERB_HOST=$VITE_REVERB_HOST
ENV VITE_REVERB_PORT=$VITE_REVERB_PORT
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_APP_MODE=$VITE_APP_MODE
ENV VITE_CUSTOMER_PORTAL_URL=$VITE_CUSTOMER_PORTAL_URL

RUN npm run build

# Stage 2: Serve the built static assets with Nginx
FROM nginx:alpine
ARG VITE_BASE_PATH=/
# Copy dist to a temporary location first
COPY --from=build /app/dist /tmp/dist
# Move files into the correct subdirectory matching the Vite base path
# For VITE_BASE_PATH=/ticketing/ → files go to /usr/share/nginx/html/ticketing/
# For VITE_BASE_PATH=/ → files go to /usr/share/nginx/html/
RUN mkdir -p /usr/share/nginx/html${VITE_BASE_PATH} && \
    cp -r /tmp/dist/* /usr/share/nginx/html${VITE_BASE_PATH}/ && \
    cp -r /tmp/dist/* /usr/share/nginx/html/ && \
    rm -rf /tmp/dist
COPY nginx.template.conf /etc/nginx/templates/default.conf.template
ENV NGINX_PORT=5005
ENV GATEWAY_HOST=ticketing-gateway
ENV GATEWAY_URL=http://ticketing-gateway:80
EXPOSE 5005
CMD ["nginx", "-g", "daemon off;"]
