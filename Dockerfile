# Avalon Online production image.
# Runs the custom Next + Socket.IO server (single process) via tsx.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
WORKDIR /app

# ---- deps: install all dependencies (incl. dev, needed for build + tsx) ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install -g npm@11.6.2
RUN npm ci

# ---- build: generate Prisma client + build Next ----
FROM base AS build
RUN npm install -g npm@11.6.2
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client must be generated before the Next build.
RUN npx prisma generate
RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy the built app and its dependencies.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/messages ./messages

EXPOSE 3000

# Apply any pending migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]