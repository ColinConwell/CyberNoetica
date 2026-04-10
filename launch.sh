#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Cybernoetica Launch Script
#
# Centralized launcher for dev and production modes with full
# control over visualizer, audio source, logging, and debug options.
#
# Usage:
#   ./launch.sh                           # Start dev server + open browser
#   ./launch.sh --viz mandelbrot          # Start with Mandelbrot visualizer
#   ./launch.sh --audio system --debug    # System audio + debug panel
#   ./launch.sh --prod                    # Run production server
#   ./launch.sh --help                    # Show all options
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────

PORT="${PORT:-5173}"
VIZ=""
AUDIO=""
LOG_MODE=""
DEBUG=""
MUTE=""
AUTOSTART=""
NO_OPEN=""
PROD=""

# Known visualizer types (for validation)
KNOWN_VIZ="orbital orbital-beta orbital-gamma mandelbrot julia waveform voronoi lissajous kaleidoscope"

# ── Argument parsing ──────────────────────────────────────────────────

show_help() {
  cat <<'HELP'
Cybernoetica Launch Script

USAGE
  ./launch.sh [OPTIONS]

OPTIONS
  --viz TYPE        Set initial visualizer
                    Types: orbital, orbital-beta, orbital-gamma,
                           mandelbrot, julia, waveform,
                           voronoi, lissajous, kaleidoscope

  --audio SOURCE    Set audio source
                    Values: system, mic, or a track name (fuzzy match)

  --log MODE        Enable log display
                    Modes: stream, floating, docked

  --debug           Enable the debug panel

  --mute            Mute speaker output (audio still drives visualizers)

  --autostart       Skip the start screen (implied when --viz or --audio set)

  --port PORT       Override the dev server port (default: 5173)

  --no-open         Start the server without opening a browser window

  --prod            Run the production server (requires prior build)

  --help            Show this help message

EXAMPLES
  ./launch.sh --viz orbital-gamma --audio system --debug
  ./launch.sh --audio mic --log stream
  ./launch.sh --prod --port 3000
  ./launch.sh --viz mandelbrot --mute
  ./launch.sh --viz mandelbrot --no-open

HELP
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --viz)       VIZ="$2"; shift 2 ;;
    --audio)     AUDIO="$2"; shift 2 ;;
    --log)       LOG_MODE="$2"; shift 2 ;;
    --debug)     DEBUG="1"; shift ;;
    --mute)      MUTE="1"; shift ;;
    --autostart) AUTOSTART="1"; shift ;;
    --port)      PORT="$2"; shift 2 ;;
    --no-open)   NO_OPEN="1"; shift ;;
    --prod)      PROD="1"; shift ;;
    --help|-h)   show_help ;;
    *)
      echo "Unknown option: $1 (try --help)"
      exit 1
      ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────

if [[ -n "$VIZ" ]]; then
  found=0
  for known in $KNOWN_VIZ; do
    [[ "$known" == "$VIZ" ]] && found=1 && break
  done
  if [[ $found -eq 0 ]]; then
    echo "Warning: '$VIZ' is not a known visualizer type."
    echo "Known types: $KNOWN_VIZ"
    echo "Proceeding anyway (the app will fall back to random if unrecognized)."
  fi
fi

if [[ -n "$LOG_MODE" ]]; then
  case "$LOG_MODE" in
    stream|floating|docked) ;;
    *)
      echo "Error: --log must be one of: stream, floating, docked"
      exit 1
      ;;
  esac
fi

# ── Build URL query string ────────────────────────────────────────────

build_query() {
  local query=""

  _append() {
    [[ -n "$query" ]] && query="${query}&"
    query="${query}${1}=${2}"
  }

  [[ -n "$VIZ" ]]       && _append "viz" "$VIZ"
  [[ -n "$AUDIO" ]]     && _append "audio" "$AUDIO"
  [[ -n "$LOG_MODE" ]]  && _append "log" "$LOG_MODE"
  [[ -n "$DEBUG" ]]     && _append "debug" ""
  [[ -n "$MUTE" ]]      && _append "mute" ""
  [[ -n "$AUTOSTART" ]] && _append "autostart" ""

  echo "$query"
}

QUERY=$(build_query)
BASE_URL="http://localhost:${PORT}"
[[ -n "$QUERY" ]] && FULL_URL="${BASE_URL}?${QUERY}" || FULL_URL="${BASE_URL}"

# ── Production mode ───────────────────────────────────────────────────

if [[ -n "$PROD" ]]; then
  echo "Starting production server on port ${PORT}..."
  cd apps/web
  PORT="$PORT" exec node server.mjs
fi

# ── Development mode ──────────────────────────────────────────────────

echo "Starting Cybernoetica dev server on port ${PORT}..."
[[ -n "$VIZ" ]]      && echo "  Visualizer: $VIZ"
[[ -n "$AUDIO" ]]    && echo "  Audio:      $AUDIO"
[[ -n "$LOG_MODE" ]] && echo "  Log:        $LOG_MODE"
[[ -n "$DEBUG" ]]    && echo "  Debug:      enabled"
[[ -n "$MUTE" ]]     && echo "  Mute:       enabled"

# Start dev server in background
pnpm dev -- --port "$PORT" &
DEV_PID=$!

cleanup() {
  kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for the server to be ready
echo "Waiting for server..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:${PORT}" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if [[ -z "$NO_OPEN" ]]; then
  echo "Opening: $FULL_URL"
  if command -v open &> /dev/null; then
    open "$FULL_URL"
  elif command -v xdg-open &> /dev/null; then
    xdg-open "$FULL_URL"
  else
    echo "Open manually: $FULL_URL"
  fi
fi

echo "Dev server running (PID $DEV_PID). Press Ctrl+C to stop."
wait "$DEV_PID"
