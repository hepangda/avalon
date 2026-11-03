FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci
COPY frontend ./frontend
ARG STATIC_ASSET_BASE_URL=
ENV STATIC_ASSET_BASE_URL=$STATIC_ASSET_BASE_URL
RUN npm run build:web

FROM rust:1.99.1-bookworm AS backend
WORKDIR /app
COPY rust-toolchain.toml ./
COPY backend ./backend
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/backend/target \
    cargo build --locked --release --bin avalon-server --manifest-path backend/Cargo.toml \
    && cp backend/target/release/avalon-server /app/avalon-server

FROM debian:bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home avalon
WORKDIR /app
ENV RUST_LOG=info
USER avalon
LABEL avalon.runtime="rust"
COPY --from=backend /app/avalon-server /usr/local/bin/avalon-server
COPY --from=frontend --chown=avalon:avalon /app/dist/client ./dist/client
EXPOSE 3000
CMD ["avalon-server"]
