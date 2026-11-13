#!/usr/bin/env bash
# Generate the three AI clips for the pitch film (shots 1-3) with fal.ai Kling 2.5 Turbo Pro, 10 s.
# Needs FAL_KEY in .env. Output: dashboard/film/clips/shotN.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
MODEL=fal-ai/kling-video/v2.5-turbo/pro/text-to-video
OUT=dashboard/film/clips; mkdir -p "$OUT"
NEG="text, logos, signs with writing, watermark, people facing camera, cartoon, blur, distortion"

P1="FPV drone shot gliding fast and low over a wet cobblestone street in an Amsterdam neighbourhood at dusk, red-brick apartment blocks, parked bicycles, glowing street lamps. The camera swoops down toward a round iron manhole cover in the street and plunges through it into a dark brick sewer tunnel, then rushes forward over the flowing water inside the tunnel. One continuous shot, fast dynamic camera motion, realistic, cinematic."
P2="A yellow excavator actively digging a trench in a Dutch red-brick street: the bucket bites into the ground, scoops soil, lifts, swings to the side and dumps it on a pile, dirt falling from the bucket, the arm moving the whole time. Orange and white barriers, a large old tree right next to the trench, a cyclist riding past. The camera slowly orbits around the excavator. Overcast daylight, realistic, continuous motion."
P3="Sewer inspection robot camera crawling steadily forward through an old cracked concrete sewer pipe, the camera lamp lighting cracks, broken joints and tree roots hanging through a joint, water flowing along the bottom, the pipe walls passing by. Continuous forward motion, gritty documentary look."

submit() { # prompt -> request id
  jq -n --arg p "$1" --arg n "$NEG" '{prompt:$p, negative_prompt:$n, duration:"10", aspect_ratio:"16:9", cfg_scale:0.5}' |
  curl -s -X POST "https://queue.fal.run/$MODEL" -H "Authorization: Key $FAL_KEY" -H 'Content-Type: application/json' -d @- | jq -r .request_id
}
ids=()
for i in 1 2 3; do v="P$i"; ids+=("$(submit "${!v}")"); echo "shot$i ${ids[${#ids[@]}-1]}"; done

BASE="https://queue.fal.run/fal-ai/kling-video/requests"
for i in 1 2 3; do
  id=${ids[$((i-1))]}
  until [ "$(curl -s -H "Authorization: Key $FAL_KEY" "$BASE/$id/status" | jq -r .status)" = COMPLETED ]; do sleep 10; done
  url=$(curl -s -H "Authorization: Key $FAL_KEY" "$BASE/$id" | jq -r .video.url)
  curl -s -o "$OUT/shot$i.mp4" "$url"; echo "shot$i done"
done
