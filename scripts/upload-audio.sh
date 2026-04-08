#!/usr/bin/env bash
# Manage audio files on the deployed Cybernoetica server.
#
# Usage:
#   ./scripts/upload-audio.sh <command> [args]
#
# Commands:
#   upload   <file> [--subdir <dir>]      Upload a single audio file
#   upload-dir <directory> [--subdir <dir>] Upload all audio files from a directory
#   list                                   List tracks on the server
#   verify                                 Check that tracks exist and report status
#
# Environment:
#   DEPLOY_HOST   Server URL (default: https://app.imbasso.com)
#   GITHUB_TOKEN  GitHub PAT with push access (default: from gh auth token)

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-https://cybernoetica-web-demo.up.railway.app}"
GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || echo "")}"
AUDIO_EXTENSIONS="mp3|wav|ogg|flac|aac|m4a"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: no GitHub token available (set GITHUB_TOKEN or run gh auth login)" >&2
  exit 1
fi

# ─── Helpers ──────────────────────────────────────────────────────────

bold()  { printf "\033[1m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
red()   { printf "\033[31m%s\033[0m" "$1"; }

upload_single() {
  local file="$1"
  local subdir="${2:-}"
  local name
  name=$(basename "$file")

  bold "$name"; printf " "

  local resp code body
  resp=$(curl -s -w "\n%{http_code}" -X POST "${DEPLOY_HOST}/api/admin/upload" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -F "file=@${file}" \
    -F "subdir=${subdir}")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [ "$code" = "200" ]; then
    green "ok"; echo ""
    return 0
  else
    red "failed ($code)"; echo " $body"
    return 1
  fi
}

upload_directory() {
  local dir="$1"
  local subdir="${2:-}"

  shopt -s nullglob globstar
  local files=()
  for f in "${dir}"/**/*.{mp3,wav,ogg,flac,aac,m4a}; do
    [ -f "$f" ] && files+=("$f")
  done

  local total=${#files[@]}
  if [ "$total" -eq 0 ]; then
    echo "No audio files found in ${dir}"
    return 0
  fi

  echo "Uploading $total files to ${DEPLOY_HOST}"
  echo ""

  local ok=0 fail=0
  for i in "${!files[@]}"; do
    local f="${files[$i]}"
    local n=$((i + 1))
    local name
    name=$(basename "$f")

    local pct=$((n * 100 / total))
    local filled=$((pct / 2))
    local empty=$((50 - filled))
    local bar gap
    bar=$(printf '%0.s#' $(seq 1 $filled 2>/dev/null) || true)
    gap=$(printf '%0.s-' $(seq 1 $empty 2>/dev/null) || true)
    printf "\r[%-50s] %3d%% (%d/%d) %s" "$bar$gap" "$pct" "$n" "$total" "$name"

    local resp code
    resp=$(curl -s -w "\n%{http_code}" -X POST "${DEPLOY_HOST}/api/admin/upload" \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -F "file=@${f}" \
      -F "subdir=${subdir}")
    code=$(echo "$resp" | tail -1)

    if [ "$code" = "200" ]; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
      local body
      body=$(echo "$resp" | sed '$d')
      printf "\n  "; red "failed ($code)"; echo " $body"
    fi
  done

  printf "\r[%-50s] 100%% (%d/%d)\n" "$(printf '%0.s#' $(seq 1 50))" "$total" "$total"
  echo ""
  echo "Done: $ok succeeded, $fail failed"

  [ "$fail" -eq 0 ]
}

list_tracks() {
  local resp code body
  resp=$(curl -s -w "\n%{http_code}" "${DEPLOY_HOST}/api/admin/tracks" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [ "$code" = "200" ]; then
    echo "$body" | python3 -m json.tool
  else
    echo "Error ($code): $body" >&2
    return 1
  fi
}

verify_tracks() {
  local resp code body
  resp=$(curl -s -w "\n%{http_code}" "${DEPLOY_HOST}/api/admin/tracks" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [ "$code" != "200" ]; then
    red "FAIL"; echo " -- could not reach track API (HTTP $code)"
    return 1
  fi

  local count dir
  count=$(echo "$body" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['tracks']))" 2>/dev/null || echo "0")
  dir=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('dir','?'))" 2>/dev/null || echo "?")

  if [ "$count" -gt 0 ]; then
    green "OK"; echo " -- $count tracks in $dir"
    return 0
  else
    red "EMPTY"; echo " -- 0 tracks in $dir"
    return 1
  fi
}

# ─── CLI ──────────────────────────────────────────────────────────────

usage() {
  cat <<'EOF'
Usage: upload-audio.sh <command> [args]

Commands:
  upload   <file> [--subdir <dir>]         Upload a single audio file
  upload-dir <directory> [--subdir <dir>]   Upload all audio from a directory
  list                                      List tracks on the server
  verify                                    Check track count and report status

Environment:
  DEPLOY_HOST   Server URL   (default: https://app.imbasso.com)
  GITHUB_TOKEN  GitHub token (default: from gh auth token)
EOF
}

parse_subdir() {
  local subdir=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --subdir) subdir="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  echo "$subdir"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  upload)
    file="${1:-}"
    shift || true
    if [ -z "$file" ] || [ ! -f "$file" ]; then
      echo "Error: provide a valid audio file path" >&2
      exit 1
    fi
    subdir=$(parse_subdir "$@")
    upload_single "$file" "$subdir"
    ;;
  upload-dir)
    dir="${1:-}"
    shift || true
    if [ -z "$dir" ] || [ ! -d "$dir" ]; then
      echo "Error: provide a valid directory path" >&2
      exit 1
    fi
    subdir=$(parse_subdir "$@")
    upload_directory "$dir" "$subdir"
    ;;
  list)
    list_tracks
    ;;
  verify)
    verify_tracks
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
