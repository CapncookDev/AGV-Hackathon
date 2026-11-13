#!/usr/bin/env bash
# Voiceover for the pitch film: one line per shot with fal.ai ElevenLabs TTS.
# Needs FAL_KEY in .env. Output: dashboard/film/clips/vo1..8.mp3
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
OUT=dashboard/film/clips; mkdir -p "$OUT"
LINES=(
  "Under one Amsterdam neighbourhood run forty kilometres of sewer."
  "Every pipe, sooner or later, needs a choice: dig it up, reline it, or wait."
  "Wait too long, and it fails. Act too early, and you waste money, and carbon."
  "So we built the neighbourhood as one model. Every pipe, every tree, every building, and the real soil underneath."
  "Straight from Waternet's knowledge graph: eighteen hundred sewer sections, one advice each."
  "For every pipe we weigh cost, disruption and carbon, all in euros, against the risk of waiting."
  "Five hundred ninety-four pipes are worth acting on now. Each one with its cost, its disruption and its carbon on the table."
  "Which pipe to dig, which to reline, and what it costs the climate."
)
for i in "${!LINES[@]}"; do
  n=$((i+1))
  url=$(jq -n --arg t "${LINES[$i]}" '{text:$t, voice:"Brian", stability:0.5, similarity_boost:0.75, speed:1.0}' |
    curl -s -X POST https://fal.run/fal-ai/elevenlabs/tts/multilingual-v2 -H "Authorization: Key $FAL_KEY" -H 'Content-Type: application/json' -d @- | jq -r .audio.url)
  curl -s -o "$OUT/vo$n.mp3" "$url"
  echo "vo$n $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/vo$n.mp3")s"
done
