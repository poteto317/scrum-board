FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /server ./cmd/server
FROM alpine:3.23
RUN addgroup -S app && adduser -S app -G app
USER app
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
