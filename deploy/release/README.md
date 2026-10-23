# Tag-triggered releases

Pushing a version tag on `main` releases it to production:

```sh
git tag v1.2.3
git push origin v1.2.3
```

[`release.yml`](../../.github/workflows/release.yml) then runs, in order:

1. The CI checks (typecheck, lint, tests).
2. Builds `Dockerfile` with `STATIC_ASSET_BASE_URL` and pushes `<repository>:v1.2.3`.
3. Copies `/app/dist/client` out of the pushed digest, then uploads and verifies
   it with `static:upload` and `static:verify` (see [static publishing](../r2/README.md)).
4. Opens the Kubernetes API through Cloudflare Access with a service token and runs
   [`rollout.sh`](rollout.sh): it patches the Deployment to the image digest, waits for
   the rollout and `/api/health`, and restores the previous image if either fails.

Tags that are not `vX.Y.Z[-suffix]` or not on `main` are rejected. Releases run one
at a time. The rollout uses the Deployment's `Recreate` strategy, so players reconnect
once per release. To redeploy an earlier version, re-run its workflow run.

## One-time setup

Create a ServiceAccount that can only read, watch and patch the `avalon` Deployment:

```sh
kubectl apply -f deploy/release/rbac.yaml
kubectl -n avalon get secret avalon-release-token -o jsonpath='{.data.token}' | base64 -d
```

In Cloudflare Zero Trust, create a service token and add a **Service Auth** policy
that includes it to the Access application in front of the Kubernetes API.

Create a GitHub environment named `production`, limited to `v*` tags, with:

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
