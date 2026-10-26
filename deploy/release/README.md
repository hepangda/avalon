# Commit-based releases

Open Actions → Release (manual) → Run workflow on `main`. Enter a full or short
commit SHA (at least seven characters), or leave `commit` as `main` to deploy its
latest commit. No Git tag is required, and pushing tags no longer deploys.

```sh
gh workflow run release-manual.yml --ref main -f commit=main
gh workflow run release-manual.yml --ref main -f commit=dede2cb -f restart=true
```

The entry resolves the target to a full SHA, verifies it belongs to `main`, and
starts `Release` using the target commit's subject as its title. The actual release
validates the SHA again and uses it for all checks and the build, so a subsequent
push cannot change the selected code. Entry success only means the release was
requested; follow the separate `Release` run for deployment status.

[`release.yml`](../../.github/workflows/release.yml) then:

1. Runs typecheck, lint and tests on the selected commit.
2. Builds and pushes `ghcr.io/hepangda/avalon:sha-<full-commit>` using the workflow's
   `GITHUB_TOKEN` with `packages: write`. Re-runs reuse the image when its static
   base matches. The GHCR package is public, so Kubernetes can also pull it anonymously.
3. Extracts static assets from that exact image, uploads missing CDN objects and
   verifies them; see [static publishing](../r2/README.md).
4. Uses deployment tooling from the workflow commit to roll Kubernetes to
   `ghcr.io/hepangda/avalon@sha256:<digest>`, with `ghcr-pull` for authentication.
   The image and pull-secret reference are patched together. Existing pull-secret
   references are retained, allowing rollback to the old registry during migration.
5. Waits for rollout and `/api/health`, restoring the previous image on failure.

Releases run one at a time. `Recreate` updates reconnect players once per release.
To roll back, request an older commit on `main`. An already-running image is left
alone unless `restart` is selected. Direct dispatch of `release.yml` accepts
`commit`, `restart` and optional `commit_title`.

## GHCR pull credentials (optional for public images)

The current deployment retains `ghcr-pull` from the initial migration setup.
Public images do not require authentication. For private images, create a classic GitHub personal access token with only `read:packages`, owned by
an account that can read the private package. Store it as a Docker registry Secret
named `ghcr-pull` in the `avalon` namespace. Do not use the workflow's short-lived
`GITHUB_TOKEN` as a persistent Kubernetes credential. Rotate the pull token before
it expires. Configure this Secret before the first GHCR deployment.

The release ServiceAccount does not need to read or write Secrets; Kubernetes
uses the pod's `imagePullSecrets` reference. Registry push credentials and the
`IMAGE_REPOSITORY` variable are no longer used. Keep the old Harbor pull Secret
until rollback to Harbor is no longer needed.

## One-time setup

Create a ServiceAccount that can only read, watch and patch the `avalon` Deployment:

```sh
kubectl apply -f deploy/release/rbac.yaml
kubectl -n avalon get secret avalon-release-token -o jsonpath='{.data.token}' | base64 -d
```

In Cloudflare Zero Trust, create a service token and add a **Service Auth** policy
that includes it to the Access application in front of the Kubernetes API.

Create a GitHub environment named `production` allowing deployments from the
`main` branch, with:

| Variable | Value |
| --- | --- |
| `STATIC_ASSET_BASE_URL` | CDN base ending in `/avalon/` |
| `STATIC_R2_BUCKET` | Public assets bucket |
| `PUBLIC_ORIGIN` | App HTTPS origin |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns the bucket |
| `K8S_ACCESS_HOSTNAME` | Access hostname of the Kubernetes API (`cloudflared access tcp`) |
| `K8S_CA_DATA` | Base64 cluster CA, as in kubeconfig `certificate-authority-data` |
| `K8S_TLS_SERVER_NAME` | API server certificate name; defaults to `kubernetes` |
| `K8S_NAMESPACE`, `K8S_DEPLOYMENT`, `K8S_CONTAINER` | Optional; default to `avalon` |

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | R2 object read/write on the bucket |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | The Access service token |
| `K8S_TOKEN` | The `avalon-release-token` ServiceAccount token |

`rollout.sh` also works from a workstation with an open tunnel and the same
`K8S_*` and `PUBLIC_ORIGIN` variables exported.
