# Commit-based ARM VM releases

Releases deploy one Rust application container on an ARM64 VM with Docker Compose.
PostgreSQL, its volume, nginx and the WARP origin connection are managed separately.
The old app stops before the new app starts; players reconnect once per release.
Failures never automatically restore an old image or database.

## Run a release

Use Actions → Release (manual) on `main`, or:

```sh
gh workflow run release-manual.yml --ref main -f commit=main
gh workflow run release-manual.yml --ref main -f commit=<full-or-short-sha> -f restart=true
```

The entry resolves the immutable commit, verifies it belongs to `main`, and starts
the separate Release workflow. Follow that run for the deployment result. An
already-running healthy image is left alone unless `restart` is requested.

Build and publish assets without changing the VM:

```sh
gh workflow run release.yml --ref main -f commit=main -f prepare_only=true
```

## Release behavior

1. Run shared CI checks against the selected commit.
2. Build natively on `ubuntu-24.04-arm` and publish
   `ghcr.io/<owner>/<repo>:sha-<full-commit>-arm64`. Reuse requires matching
   architecture, OS, Rust runtime, commit and static asset base.
3. Extract resources from that exact image and publish/verify CDN objects.
4. Connect with a restricted SSH key and pinned host key. The VM anonymously pulls
   the public GHCR digest and verifies repository, Linux ARM64, Rust and commit.
5. Require an already-healthy database, create a consistent PostgreSQL dump, stop
   the app with a 30-second grace period, atomically update only `APP_IMAGE` in
   `.env`, then recreate only `app` with `--no-deps --pull never`.
6. Check the running image ID and local `/api/health`, then check the public HTTPS
   endpoint. Save `release.json` and the pre-release dump for recovery.

GitHub concurrency and a VM file lock prevent overlapping releases. Pull,
validation and backup failures leave the old app running. After a new image
starts, repair forward on failure. Database credentials, OIDC settings and volumes
are not replaced. Dumps under `/var/backups/avalon/releases` are not automatically
pruned; include them in the installation's backup retention policy.

## VM setup

Install Docker Engine/Compose and Python 3. The existing production Compose file
at `/opt/avalon/compose.yaml` must have services `db` and `app`, with app port 3000
bound to loopback and `${APP_IMAGE}` as its image. `.env` must contain exactly one
`APP_IMAGE=...` entry. Do not deploy the root development Compose file, which builds
the app. The workflow never creates or starts the database.

Install the server scripts using an administrator account. Update them explicitly
when server-side release logic changes:

```sh
sudo install -m 0755 vm-rollout.py /usr/local/sbin/avalon-vm-rollout
sudo install -d -m 0755 /usr/local/libexec
sudo install -m 0755 ssh-gateway.py /usr/local/libexec/avalon-release-gateway
```

Create root-owned `/etc/avalon-deploy.json`:

```json
{
  "directory": "/opt/avalon",
  "repository": "ghcr.io/<owner>/<repo>",
  "backup_directory": "/var/backups/avalon/releases"
}
```

Generate a dedicated ED25519 deployment key. Its public key goes in the chosen
SSH user's `authorized_keys` with this prefix, all on one line:

```text
restrict,command="/usr/local/libexec/avalon-release-gateway" ssh-ed25519 <public-key> avalon-release
```

The SSH user needs passwordless sudo for `/usr/local/sbin/avalon-vm-rollout`.
The root-owned gateway permits only `check` and
`deploy <digest> sha-<full-commit> [--restart]`; the privileged script independently
checks the configured repository. This key must not permit a shell, forwarding,
SFTP/SCP, or uploads of replacement release scripts.

Verify with the restricted key and trusted host-key file:

```sh
ssh -i <release-key> -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=<known-hosts> <user>@<vm-host> check
```

This does not restart the app. A command such as `id` must be rejected. Verify
host fingerprints through an already trusted connection; do not learn host keys
dynamically in Actions.

## GitHub production environment

Keep branch restrictions to `main` and the existing CDN credentials.

| Variable | Purpose |
| --- | --- |
| `VM_HOST`, `VM_USER` | VM SSH address and deployment user |
| `VM_SSH_KNOWN_HOSTS` | Pinned OpenSSH host-key lines matching `VM_HOST` |
| `PUBLIC_ORIGIN` | App HTTPS origin |
| `STATIC_ASSET_BASE_URL` | CDN base ending in `/avalon/` |
| `STATIC_R2_BUCKET`, `CLOUDFLARE_ACCOUNT_ID` | Existing static publishing settings |

| Secret | Purpose |
| --- | --- |
| `VM_SSH_PRIVATE_KEY` | Dedicated restricted deployment key |
| `CLOUDFLARE_API_TOKEN` | Existing R2 publishing credentials |

GHCR pushes use the job's short-lived `GITHUB_TOKEN`; the package must
remain public so the VM can pull anonymously.
