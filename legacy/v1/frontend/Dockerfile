FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json /app/
RUN npm ci --no-audit --no-fund

ARG VITE_API_URL=/api
ARG VITE_V2_WEB_URL=https://app.maulya.in
ARG VITE_APP_INSTANCE=pilot
ARG VITE_PILOT_MODE=0
ARG VITE_ENABLE_STRUCTURED_INPUTS=0
ARG VITE_DEMO_MODE=0
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_V2_WEB_URL=$VITE_V2_WEB_URL
ENV VITE_APP_INSTANCE=$VITE_APP_INSTANCE
ENV VITE_PILOT_MODE=$VITE_PILOT_MODE
ENV VITE_ENABLE_STRUCTURED_INPUTS=$VITE_ENABLE_STRUCTURED_INPUTS
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE

COPY . /app
RUN npm run build

FROM nginx:1.25-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html \
    && chown -R nginx:nginx /var/cache/nginx \
    && chown -R nginx:nginx /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown -R nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
