#!/usr/bin/env bash
# Generate the three AI clips for the pitch film (shots 1-3) with fal.ai Kling 2.1 Master.
# Needs FAL_KEY in .env. Output: dashboard/film/clips/shotN.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
MODEL=fal-ai/kling-video/v2.1/master/text-to-video
OUT=dashboard/film/clips; mkdir -p "$OUT"
NEG="text, logos, signs with writing, watermark, people facing camera, cartoon, blur, distortion"

P1="Cinematic shot at dusk in a quiet Amsterdam neighbourhood: wet red-brick street, rows of 1930s brick apartment blocks, parked bicycles, street lamps glowing. The camera slowly tilts down to the cobblestones and seamlessly descends below the street into an old dark brick sewer tunnel with water flowing through it. Moody, realistic, shallow depth of field, 35mm film look."
P2="Cinematic wide shot of a Dutch city street opened up for sewer works: a yellow excavator digging a deep trench, orange and white barriers, a large old plane tree right next to the trench, cyclists detouring around the works, red-brick apartment buildings behind. Overcast daylight, realistic, slow dolly forward."
P3="Realistic sewer inspection camera view moving slowly forward inside an old concrete sewer pipe: visible cracks, displaced joints, tree roots growing through a joint, a thin stream of water at the bottom, light from the camera lamp falling off into darkness. Gritty, documentary look."

submit() { # prompt -> request id
  jq -n --arg p "$1" --arg n "$NEG" '{prompt:$p, negative_prompt:$n, duration:"5", aspect_ratio:"16:9", cfg_scale:0.5}' |
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
