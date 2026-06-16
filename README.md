# Avalon Online

A production-grade online implementation of Avalon for 5-10 friends, no login required. The server enforces role assignment, team voting, mission resolution, Lady of the Lake, assassination, reconnection, spectating, and full post-game replay.

- Mobile-first, real-time, medieval-fantasy themed.
- i18n: Simplified Chinese (default) + English.
- Roles: Merlin, Percival, Loyal Servant, Morgana, Assassin, Oberon, Mordred, and Minion of Mordred. Lady of the Lake is optional.

## Tech stack

- Next.js 15 (App Router), React 19, TypeScript strict mode
- TailwindCSS, Framer Motion, Zustand
- Socket.IO hosted in a custom server alongside Next.js
- PostgreSQL + Prisma for checkpoint persistence and replay
- next-intl for i18n

## Architecture

The authoritative game state lives in memory in a single Node process. A pure deterministic engine in `src/lib/engine/` drives the rules. The Socket.IO layer projects per-viewer state so clients never see hidden roles or mission cards they should not see, and persists key checkpoints to Postgres for reconnect recovery and replay.

Because Socket.IO needs persistent connections, this app must run on a long-process host or a normal cloud server. It is not a good fit for serverless or edge-only platforms like Vercel. Locale routing that would normally use Next middleware is handled in `server.ts` because middleware does not run under this custom server.

## Local development

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Open multiple browser tabs or phones on the same network to simulate players.

## Scripts

- `npm run dev`: custom server with hot reload
- `npm run build`: production Next.js build
- `npm run start`: production custom server
- `npm test`: engine unit tests
- `npm run typecheck`: TypeScript check
- `npm run lint`: ESLint

## Environment variables

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection URL for the app runtime |
| `DIRECT_URL` | Direct Postgres URL for Prisma migrations |
| `PORT` | Server port inside the process, default `3000` |
| `HOST` | Bind host, default `0.0.0.0` |

## One-command cloud server deployment

This project includes a production Docker Compose setup for a single Linux cloud server. It runs the custom Next.js + Socket.IO app on host port `8001` and keeps Postgres on the internal Docker network.

Server prerequisites:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git
sudo systemctl enable --now docker
```

Deploy from the repository directory:

```bash
./scripts/prod-up.sh
```

The first run creates `.env.prod` automatically and generates a database password. The app is exposed at:

```text
http://YOUR_SERVER_IP:8001
```

Stop the app but keep the database volume:

```bash
./scripts/prod-down.sh
```

Fully destroy the deployment, including containers, network, database volume, and the locally built image:

```bash
./scripts/prod-destroy.sh
```

Useful operational commands:

```bash
set -a; . ./.env.prod; set +a; docker compose -f docker-compose.prod.yml ps
set -a; . ./.env.prod; set +a; docker compose -f docker-compose.prod.yml logs -f app
set -a; . ./.env.prod; set +a; docker compose -f docker-compose.prod.yml logs -f postgres
```

To change the public port, edit `APP_PORT` in `.env.prod` and run `./scripts/prod-up.sh` again.

## Kubernetes deployment

This project also includes plain Kubernetes manifests in `k8s/`. They deploy one app Pod, one Postgres StatefulSet, internal Services, and an Istio Gateway/VirtualService for `avalon.pangda.app`.

Important: game room state is currently stored in memory inside a single Node.js process, so keep the app at `replicas: 1`. Scaling to multiple app Pods requires externalizing room state or adding routing that always sends a room to the same process.

Prerequisites:

```bash
kubectl version --client
docker buildx version
```

The cluster should have Istio installed with an ingress gateway whose labels include `istio: ingressgateway`. Point the DNS record for `avalon.pangda.app` at that ingress gateway's external address.

Build and push the production image:

```bash
docker build -t YOUR_REGISTRY/avalon-online:latest .
docker push YOUR_REGISTRY/avalon-online:latest
```

Point the deployment at that image:

```bash
kubectl kustomize k8s | sed 's#avalon-online:latest#YOUR_REGISTRY/avalon-online:latest#' | kubectl apply -f -
```

Before production use, change `POSTGRES_PASSWORD`, `DATABASE_URL`, and `DIRECT_URL` in `k8s/secret.yaml`. If you already use a managed Postgres database, replace those two URLs with the managed database connection string and skip `k8s/postgres.yaml` in `k8s/kustomization.yaml`.

For a local cluster, load the image into the cluster instead of pushing it:

```bash
docker build -t avalon-online:latest .
minikube image load avalon-online:latest
# or, for Kind:
kind load docker-image avalon-online:latest
kubectl apply -k k8s
```

After deployment, open:

```text
http://avalon.pangda.app
```

To find the Istio ingress address:

```bash
kubectl -n istio-system get svc istio-ingressgateway
```

For any cluster, you can also test the app Service directly through port-forwarding:

```bash
kubectl -n avalon port-forward svc/avalon-app 8001:3000
```

Then open:

```text
http://localhost:8001
```

Istio Gateway and VirtualService resources are defined in `k8s/ingress.yaml`. Socket.IO uses normal HTTP/WebSocket upgrade traffic, which Istio passes through the HTTP route.

Useful operational commands:

```bash
kubectl -n avalon get pods,svc,gateway,virtualservice
kubectl -n istio-system get svc istio-ingressgateway
kubectl -n avalon logs deploy/avalon-app -f
kubectl -n avalon logs statefulset/postgres -f
```

Remove the Kubernetes deployment:

```bash
kubectl delete -k k8s
```

## Render deployment

1. Push this repo to GitHub.
2. In Render, create a Blueprint from `render.yaml`.
3. Set `DATABASE_URL` and `DIRECT_URL` in the dashboard.
4. Deploy. The container runs `prisma migrate deploy` and then starts the server. Health check path: `/api/health`.

## Game flow

Lobby -> role reveal -> team building -> vote -> mission -> result, repeated up to 5 missions. If enabled, Lady of the Lake runs after missions 2-4. If good wins 3 missions, assassination runs before game over. Finished games include full reveal and replay.
