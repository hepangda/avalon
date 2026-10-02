# Kubernetes deployment constraints

This repository provides a working Docker Compose setup at the project root.
Kubernetes resources must be prepared for your own registry, namespace, storage,
OIDC client and HTTPS ingress. Site-specific manifests and one-time migration
scripts have been removed from the public tree.

- Run one application replica per database and use `Recreate` updates. Stop the
  old process before starting the new one; the database ownership lock rejects
  concurrent owners. Allow at least 20 seconds for graceful termination.
- Build `Dockerfile`, push it to your registry and pin the deployment to its
  immutable image digest. If using a CDN, publish resources from that exact image
  before deploying it; see [static publishing](../r2/README.md).
- Supply the variables in `.env.example`. Put database credentials and OIDC client
  and session secrets in a Secret. Keep the session secret stable across releases.
- Set `PUBLIC_ORIGIN` to your HTTPS origin, register its OIDC callback and configure
  ingress for WebSocket upgrades. Avoid retrying state-changing application requests.
- Use `/api/health` for readiness and startup checks; a TCP check on port 3000 can
  provide liveness without restarting the app for a transient database outage.
- Run as the image's non-root user, disable service-account token mounting, and
  set resource requests/limits for the workload.
- Use durable PostgreSQL storage. A single database instance with node-local
  storage has no automatic failover. Establish backups, retention and recovery
  drills appropriate to your installation.

Backups must capture room snapshots and the room journal in one consistent
snapshot. An older snapshot-only application cannot safely open the current
journal schema. Restore into a separate database for verification before a
cutover; an image rollback alone does not reverse a database migration. See
[architecture and crash recovery](../../docs/architecture.md).

The local `.private/` archive retains the previous deployment and recovery records.
It is excluded from Git and Docker and is not a deployment bundle. Maintain active
production operations in a separate private repository.
