FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
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
    cargo build --locked --release --no-default-features --bin avalon-server --manifest-path backend/Cargo.toml \
    && cp backend/target/release/avalon-server /app/avalon-server

# One-shot legacy import is a separate optional build target. Its feature-enabled
# binary is never copied into the production image, nor can it overwrite the
# already copied default-feature server executable.
FROM backend AS migration-builder
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/backend/target \
    cargo build --locked --release --features legacy-import --bin migrate-randomness --manifest-path backend/Cargo.toml \
    && cp backend/target/release/migrate-randomness /app/migrate-randomness

FROM debian:bookworm-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home avalon
WORKDIR /app
ENV RUST_LOG=info
USER avalon

FROM runtime-base AS migration-tool
LABEL avalon.runtime="legacy-import"
COPY --from=migration-builder /app/migrate-randomness /usr/local/bin/migrate-randomness
ENTRYPOINT ["migrate-randomness"]

FROM runtime-base AS production
LABEL avalon.runtime="rust"
COPY --from=backend /app/avalon-server /usr/local/bin/avalon-server
COPY --from=frontend --chown=avalon:avalon /app/dist/client ./dist/client
EXPOSE 3000
CMD ["avalon-server"]
