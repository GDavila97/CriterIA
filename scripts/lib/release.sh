# Checks shared by the manual release scripts. Source it; it does not run on its own.
# shellcheck shell=bash

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_tools() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed"
  done
}

# With DRY_RUN=1 the commands that change something are printed instead of run.
run() {
  if [[ ${DRY_RUN:-0} == 1 ]]; then
    printf '[dry run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

# The release must be a full SHA on origin/main, from a clean tree, with CI green on main.
verify_release_sha() {
  local sha=$1 passed
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || die "pass the full 40-character commit SHA"
  [[ -z $(git status --porcelain) ]] || die "the working tree is not clean"
  git fetch --quiet origin main
  git cat-file -e "${sha}^{commit}" 2>/dev/null || die "commit $sha does not exist here"
  git merge-base --is-ancestor "$sha" origin/main || die "$sha is not on origin/main"
  passed=$(gh run list --workflow ci.yml --branch main --commit "$sha" --status success \
    --json databaseId --jq length)
  [[ $passed -gt 0 ]] || die "CI has not passed on main for $sha"
}
