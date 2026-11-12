#!/usr/bin/env bash
# Deploys the web of a commit on main to Vercel production, after the API of that same commit.
# Run by hand from the repository linked with `vercel link`:
#   GCP_PROJECT_ID=<project> apps/web/scripts/deploy.sh <sha>
# DRY_RUN=1 checks everything and prints the deploy command without running it.
set -euo pipefail

REGION=us-central1
API_SERVICE=criteria-api

repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
# shellcheck source=SCRIPTDIR/../../../scripts/lib/release.sh
source "$repo/scripts/lib/release.sh"

usage() {
  die "usage: GCP_PROJECT_ID=<project> $0 <sha>"
}

# The sequence is migrations, API, web: the API in Cloud Run must already run this commit.
verify_api_commit() {
  local sha=$1 deployed
  deployed=$(gcloud run services describe "$API_SERVICE" --project="$GCP_PROJECT_ID" \
    --region="$REGION" --format='value(metadata.labels.commit-sha)')
  [[ $deployed == "$sha" ]] || die "the API runs ${deployed:-nothing}; deploy $sha there first"
}

main() {
  local sha=${1:-} link
  [[ -n $sha && -n ${GCP_PROJECT_ID:-} ]] || usage
  require_tools git gh jq
  [[ ${DRY_RUN:-0} == 1 ]] || require_tools gcloud vercel
  cd "$repo"
  link="$repo/.vercel/project.json"
  [[ -f $link ]] || die "run 'vercel link' at the repository root first"
  verify_release_sha "$sha"
  [[ ${DRY_RUN:-0} == 1 ]] || verify_api_commit "$sha"

  # A detached worktree uploads exactly the commit: no .env files and no local changes.
  scratch=$(mktemp -d)
  worktree="$scratch/criteria"
  git worktree add --quiet --detach "$worktree" "$sha"
  trap 'git -C "$repo" worktree remove --force "$worktree"; rm -rf "$scratch"' EXIT

  # Vercel builds remotely with the production variables of the project.
  VERCEL_ORG_ID=$(jq -r .orgId "$link") VERCEL_PROJECT_ID=$(jq -r .projectId "$link") \
    run vercel deploy --prod --yes --cwd "$worktree"
}

main "$@"
