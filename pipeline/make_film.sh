#!/usr/bin/env bash
# Build dashboard/video/pitch.mp4 from: AI clips + voice (fal_clips.sh, fal_voice.sh) and browser-rendered frames (record_film.mjs).
# Usage: pipeline/make_film.sh <workDir>   (dashboard must be served on :8780; playwright-core installed next to record_film.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."
W=${1:?workDir}; C=dashboard/film/clips; V=dashboard/video; mkdir -p "$W" "$V"
node pipeline/record_film.mjs "$W/frames" 18 60 25                 # real dashboard footage, 18-60 s
OVERLAY=1 node pipeline/record_film.mjs "$W/ov" 0 18 25            # captions over the AI shots, 0-18 s
# AI shots: play the first 7.5 / 8 / 8 s of each 10 s clip in 6 s, captions on top
ffmpeg -v error -y -i $C/shot1.mp4 -i $C/shot2.mp4 -i $C/shot3.mp4 -framerate 25 -i "$W/ov/o%04d.png" -filter_complex \
 "[0:v]trim=0:7.5,setpts=(PTS-STARTPTS)*6/7.5,fps=25,scale=1920:1080,setsar=1,trim=end_frame=150[a];[1:v]trim=0:8,setpts=(PTS-STARTPTS)*6/8,fps=25,scale=1920:1080,setsar=1,trim=end_frame=150[b];[2:v]trim=0:8,setpts=(PTS-STARTPTS)*6/8,fps=25,scale=1920:1080,setsar=1,trim=end_frame=150[c];[a][b][c]concat=n=3:v=1[base];[base][3:v]overlay=0:0:shortest=1" \
 -q:v 2 -start_number 0 "$W/frames/f%04d.jpg"
# voiceover: one line per shot
D=(400 6300 12300 18400 26400 34400 42400 52400); in=""; f=""
for i in 0 1 2 3 4 5 6 7; do in="$in -i $C/vo$((i+1)).mp3"; f="${f}[$((i+1)):a]adelay=${D[$i]}|${D[$i]}[a$i];"; done
ffmpeg -v error -y -framerate 25 -i "$W/frames/f%04d.jpg" $in -filter_complex "${f}[a0][a1][a2][a3][a4][a5][a6][a7]amix=inputs=8:normalize=0,apad,atrim=0:60,afade=t=out:st=58.5:d=1.5[a];[0:v]fade=t=in:st=0:d=0.5[v]" \
 -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 160k -t 60 $V/pitch.mp4
ffmpeg -v error -y -i "$W/frames/f0040.jpg" -q:v 3 -vf scale=1280:-2 $V/poster.jpg
