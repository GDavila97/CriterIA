#!/usr/bin/env bash
# Smoke test after a deploy, from any machine with curl, jq and the web dependencies installed:
#   scripts/smoke-prod.sh <api_url> <web_url>
# Read-only: it never signs in and never starts a run. Exits non-zero if any check fails.
set -uo pipefail

[[ $# -eq 2 ]] || {
  printf 'usage: %s <api_url> <web_url>\n' "$0" >&2
  exit 2
}
api=${1%/}
web=${2%/}
foreign=https://not-the-web.example
repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
failures=0

check() {
  local label=$1
  shift
  if "$@"; then
    printf 'ok    %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label"
    failures=$((failures + 1))
  fi
}

status() {
  curl --silent --output /dev/null --write-out '%{http_code}' "$@"
}

# Response headers with lowercase names, so lookups ignore the server's casing.
headers() {
  curl --silent --output /dev/null --dump-header - "$@" | tr -d '\r' |
    awk -F': ' 'NF > 1 { name = tolower($1); sub(/^[^:]*: /, ""); print name ": " $0 }'
}

header() {
  printf '%s\n' "$1" | awk -v name="$2" -F': ' '$1 == name { sub(/^[^:]*: /, ""); print; exit }'
}

equals() { [[ $1 == "$2" ]]; }
contains() { [[ $1 == *"$2"* ]]; }
lacks() { [[ $1 != *"$2"* ]]; }
redirects_to_https() {
  local location
  location=$(curl --silent --output /dev/null --write-out '%{redirect_url}' "$1")
  [[ $location == https://* ]]
}

origin_of() {
  printf '%s\n' "$1" | sed -E 's#^(https?://[^/]+).*#\1#'
}

api_checks() {
  local body api_headers
  check "API /health answers 200" equals "$(status "$api/health")" 200
  for path in /me/settings /me/usage /me/runs /me/credentials; do
    check "API $path without a token answers 401" equals "$(status "$api$path")" 401
  done
  check "API rejects a forged token with 401" \
    equals "$(status -H 'Authorization: Bearer not-a-token' "$api/me/settings")" 401

  body=$(curl --silent "$api/evaluation")
  check "API /evaluation returns the published batches" \
    equals "$(jq '(.lotes | length) > 0' <<<"$body" 2>/dev/null)" true
  check "API /evaluation includes the judge agreement" \
    equals "$(jq '.acuerdo_juez != null' <<<"$body" 2>/dev/null)" true

  api_headers=$(headers "$api/health")
  check "API sends nosniff" equals "$(header "$api_headers" x-content-type-options)" nosniff
  check "API denies framing" equals "$(header "$api_headers" x-frame-options)" DENY
  check "API sends HSTS" contains "$(header "$api_headers" strict-transport-security)" max-age=
  check "API sends a closed CSP" \
    contains "$(header "$api_headers" content-security-policy)" "default-src 'none'"
  check "API sends no referrer" equals "$(header "$api_headers" referrer-policy)" no-referrer
  check "API redirects http to https" redirects_to_https "${api/https:/http:}/health"
}

cors_checks() {
  local allowed refused simple
  allowed=$(headers -X OPTIONS "$api/runs" -H "Origin: $web" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: authorization,content-type')
  check "CORS preflight allows the web origin" \
    equals "$(header "$allowed" access-control-allow-origin)" "$web"
  check "CORS never allows credentials" \
    equals "$(header "$allowed" access-control-allow-credentials)" ""
  refused=$(headers -X OPTIONS "$api/runs" -H "Origin: $foreign" \
    -H 'Access-Control-Request-Method: POST')
  check "CORS preflight refuses another origin" \
    equals "$(header "$refused" access-control-allow-origin)" ""
  simple=$(headers "$api/evaluation" -H "Origin: $foreign")
  check "CORS gives no access to another origin on public reads" \
    equals "$(header "$simple" access-control-allow-origin)" ""
}

web_checks() {
  local web_headers csp connect
  check "Web home answers 200" equals "$(status "$web/")" 200
  web_headers=$(headers "$web/")
  csp=$(header "$web_headers" content-security-policy)
  connect=$(printf '%s\n' "$csp" | tr ';' '\n' | sed 's/^ *//' | grep '^connect-src ' || true)
  check "Web CSP uses a nonce for scripts" contains "$csp" "'nonce-"
  check "Web CSP lets the browser reach the API" contains "$connect" "$(origin_of "$api")"
  check "Web CSP forbids framing" contains "$csp" "frame-ancestors 'none'"
  check "Web CSP upgrades insecure requests" contains "$csp" upgrade-insecure-requests
  check "Web CSP has no unsafe-eval" lacks "$csp" unsafe-eval
  check "Web sends HSTS" contains "$(header "$web_headers" strict-transport-security)" max-age=
  check "Web denies framing" equals "$(header "$web_headers" x-frame-options)" DENY
  check "Web sends nosniff" equals "$(header "$web_headers" x-content-type-options)" nosniff
  check "Web sends a referrer policy" \
    equals "$(header "$web_headers" referrer-policy)" strict-origin-when-cross-origin
  check "Web sends a permissions policy" \
    contains "$(header "$web_headers" permissions-policy)" "camera=()"
  check "Web serves the JWKS the API trusts" \
    equals "$(curl --silent "$web/api/auth/jwks" | jq '.keys | type == "array"' 2>/dev/null)" true
  check "Web redirects http to https" redirects_to_https "${web/https:/http:}/"
}

browser_checks() {
  check "Web loads in Chromium without CSP violations (desktop and 390 px)" \
    env SMOKE_WEB_URL="$web" pnpm --dir "$repo/apps/web" --silent exec playwright test \
    --config playwright.smoke.config.ts
}

for tool in curl jq pnpm; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf '%s is not installed\n' "$tool" >&2
    exit 2
  }
done

api_checks
cors_checks
web_checks
browser_checks

if [[ $failures -gt 0 ]]; then
  printf '\n%d checks failed\n' "$failures"
  exit 1
fi
printf '\nAll checks passed\n'
