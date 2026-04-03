#!/usr/bin/env bash
# Upload local audio samples to the Railway volume.
#
# Usage:
#   ./scripts/upload-audio.sh
#
# Prerequisites:
#   - Railway CLI authenticated and linked to the Cybernoetica project
#   - Local audio files in data/sample-music/
#
# This creates a tar archive of the audio files, pipes it through
# railway ssh, and extracts it into /data/audio on the container.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUDIO_SRC="$REPO_ROOT/data/sample-music"

if [ ! -d "$AUDIO_SRC" ]; then
  echo "Error: $AUDIO_SRC not found"
  exit 1
fi

FILE_COUNT=$(find "$AUDIO_SRC" -type f \( -name '*.mp3' -o -name '*.wav' -o -name '*.ogg' -o -name '*.flac' -o -name '*.aac' -o -name '*.m4a' \) | wc -l | tr -d ' ')
echo "Found $FILE_COUNT audio files in $AUDIO_SRC"
echo "Uploading to Railway volume at /data/audio ..."
echo ""
echo "NOTE: This requires an interactive terminal."
echo "  Run: cd $REPO_ROOT && tar -cf - -C data/sample-music . | railway ssh --command 'tar -xf - -C /data/audio'"
echo ""
echo "Or connect interactively:"
echo "  railway ssh"
echo "  # Then in another terminal:"
echo "  # tar -cf - -C data/sample-music . | ssh <railway-ssh-details> 'tar -xf - -C /data/audio'"
