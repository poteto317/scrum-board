FROM node:24-alpine AS fe-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM golang:1.26-alpine AS api-build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 go build -trimpath -o /server ./cmd/server

FROM nginx:1.28-alpine
RUN apk add --no-cache apache2-utils gettext wget
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && rm -f /etc/nginx/conf.d/default.conf
COPY --from=api-build /server /server
COPY --from=fe-build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]