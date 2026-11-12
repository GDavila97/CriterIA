#!/usr/bin/env bash
# Builds the API image of a commit on main and deploys it to Cloud Run. Run by hand, never from CI:
#   GCP_PROJECT_ID=<project> services/api/scripts/deploy.sh <sha>
# DRY_RUN=1 checks everything and prints the build and deploy commands without running them.
set -euo pipefail

REGION=us-central1
SERVICE=criteria-api
REPOSITORY=criteria
SETTINGS=services/api/deploy/production.env
SECRETS=(
  DATABASE_URL=criteria-database-url:latest
  CREDENTIALS_KEYS=criteria-credentials-keys:latest
  GROQ_API_KEY=criteria-groq-api-key:latest
  SENTRY_DSN=criteria-sentry-dsn:latest
)
# Sizes measured in F6; see docs/deploy.md before changing them.
RESOURCES=(
  --cpu=1 --memory=512Mi --concurrency=10 --timeout=900
  --min-instances=0 --max-instances=2 --cpu-throttling --execution-environment=gen1
)

repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
# shellcheck source=SCRIPTDIR/../../../scripts/lib/release.sh
source "$repo/scripts/lib/release.sh"

usage() {
  die "usage: GCP_PROJECT_ID=<project> $0 <sha>"
}

# KEY=value lines of production.env as YAML for --env-vars-file, with WEB_URL expanded.
render_env_vars() {
  local settings=$1 key value web_url=""
  while IFS='=' read -r key value; do
    [[ -z $key || $key == \#* ]] && continue
    [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || die "bad line in $SETTINGS: $key"
    if [[ $key == WEB_URL ]]; then
      web_url=$value
      continue
    fi
    printf "%s: '%s'\n" "$key" "${value//\'/\'\'}"
  done <<<"$settings"
  [[ $web_url =~ ^https://[a-z0-9.-]+$ ]] || die "set WEB_URL in $SETTINGS (https origin, no slash)"
  printf "WEB_ORIGIN: '%s'\n" "$web_url"
  printf "AUTH_JWKS_URL: '%s/api/auth/jwks'\n" "$web_url"
  printf "AUTH_ISSUER: '%s'\n" "$web_url"
  printf "AUTH_AUDIENCE: '%s'\n" "$web_url"
}

image_exists() {
  [[ ${DRY_RUN:-0} == 1 ]] && return 1
  gcloud artifacts docker images describe "$1" >/dev/null 2>&1
}

main() {
  local sha=${1:-} image secrets
  [[ -n $sha && -n ${GCP_PROJECT_ID:-} ]] || usage
  require_tools git gh docker
  [[ ${DRY_RUN:-0} == 1 ]] || require_tools gcloud
  cd "$repo"
  verify_release_sha "$sha"

  image="$REGION-docker.pkg.dev/$GCP_PROJECT_ID/$REPOSITORY/api:$sha"
  env_file=$(mktemp)
  context=$(mktemp -d)
  trap 'rm -rf "${env_file:-}" "${context:-}"' EXIT
  render_env_vars "$(git show "$sha:$SETTINGS")" >"$env_file"

  if image_exists "$image"; then
    printf 'Reusing %s\n' "$image"
  else
    # The archive holds exactly the commit, whatever else is in the working copy.
    git archive "$sha" services/api | tar -x -C "$context"
    run docker buildx build --platform linux/amd64 --provenance=false \
      --label "org.opencontainers.image.revision=$sha" \
      --tag "$image" --push "$context/services/api"
  fi

  secrets=$(IFS=,; printf '%s' "${SECRETS[*]}")
  run gcloud run deploy "$SERVICE" --project="$GCP_PROJECT_ID" --region="$REGION" \
    --image="$image" --service-account="$SERVICE@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --allow-unauthenticated --port=8080 "${RESOURCES[@]}" \
    --env-vars-file="$env_file" --set-secrets="$secrets" \
    --labels="commit-sha=$sha" --quiet
  if [[ ${DRY_RUN:-0} == 1 ]]; then
    printf -- '--- env vars file ---\n'
    cat "$env_file"
    return
  fi

  local url
  url=$(gcloud run services describe "$SERVICE" --project="$GCP_PROJECT_ID" --region="$REGION" \
    --format='value(status.url)')
  curl --fail --silent --show-error --retry 5 --retry-all-errors "$url/health" >/dev/null
  printf 'Deployed %s to %s\n' "$sha" "$url"
}

main "$@"
