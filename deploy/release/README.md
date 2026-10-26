# Tag-triggered releases

Pushing a version tag on `main` releases it to production:

```sh
git tag v1.2.3
git push origin v1.2.3
```

[`release.yml`](../../.github/workflows/release.yml) then runs, in order:

1. The CI checks (typecheck, lint, tests).
2. Builds `Dockerfile` with `STATIC_ASSET_BASE_URL` and pushes it as `<repository>:v1.2.3`
   and `<repository>:sha-<commit>`. If `sha-<commit>` already exists with the same
   static base (a re-run, or another tag on the same commit), it only adds the
   version tag to that image.
3. Copies `/app/dist/client` out of that digest, then uploads the assets the CDN
   does not have yet and verifies all of them with `static:upload` and
   `static:verify` (see [static publishing](../r2/README.md)).
4. Opens the Kubernetes API through Cloudflare Access with a service token and runs
   [`rollout.sh`](rollout.sh): it patches the Deployment to the image digest, waits for
   the rollout and `/api/health`, and restores the previous image if either fails.

Tags that are not `vX.Y.Z[-suffix]` or not on `main` are rejected. Releases run one
at a time. The rollout uses the Deployment's `Recreate` strategy, so players reconnect
once per release.

## Manual deploys

To deploy an existing tag again, or roll back to an earlier one, open
Actions → Release → Run workflow. Select `main` or a version tag as the workflow
ref, enter the existing tag to deploy in `version`, and optionally enable `restart`:

```sh
gh workflow run release.yml --ref main -f version=v1.2.3
gh workflow run release.yml --ref main -f version=v1.2.3 -f restart=true
gh workflow run release.yml --ref v1.2.3 -f version=v1.2.3
```

The selected ref supplies the workflow; `version` determines which tag's commit
is checked and deployed. The target commit must still belong to `main`.
Older tags retain their original workflow, so tags created before manual tag-ref
support must be deployed by selecting `main` and entering the old tag in `version`.
If the tag's image is already running, nothing changes unless `restart` is set, which
restarts the pod (players reconnect) and waits for `/api/health` again.

## One-time setup

Create a ServiceAccount that can only read, watch and patch the `avalon` Deployment:

```sh
kubectl apply -f deploy/release/rbac.yaml
kubectl -n avalon get secret avalon-release-token -o jsonpath='{.data.token}' | base64 -d
```

In Cloudflare Zero Trust, create a service token and add a **Service Auth** policy
that includes it to the Access application in front of the Kubernetes API.

Create a GitHub environment named `production`, limited to `v*` tags and the
`main` branch (for manual deploys), with:

| Variable | Value |
| --- | --- |
| `IMAGE_REPOSITORY` | Image repository without a tag, such as `registry.example.com/avalon/avalon` |
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
| `REGISTRY_USERNAME`, `REGISTRY_PASSWORD` | Registry account that can push the repository |
| `CLOUDFLARE_API_TOKEN` | R2 object read/write on the bucket |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | The Access service token |
| `K8S_TOKEN` | The `avalon-release-token` ServiceAccount token |

`rollout.sh` also works from a workstation with an open tunnel and the same
`K8S_*` and `PUBLIC_ORIGIN` variables exported.
