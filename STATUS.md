# V5 checkpoint — 2026-11-24 18:47 TRT
Branch: design/live-stage-v5-20261124. Production remains v4 af8002e.
Implemented light watch-first design, responsive catalogue, inline HLS player, muted autoplay, actual decoded height indicator, retry, mobile 230px stage minimum and constrained width; corrected pause status.
Verified: Node syntax; DOM initialization, 8 collections, 3 curated covers, 12 previews, search, episode 15/16 navigation, close cleanup.
Remote candidate server http://127.0.0.1:18092: health playing=true current1481 pinned; playlist HTTP200; segment HTTP200 773620 bytes; ffprobe h264 1920x1080.
Cloud browser 390px and 320px iframe viewport QA: widths375/305 excluding scrollbars, scroll widths match; mobile clipping fixed. Not physical-device testing.
Blocked: cloud preview cannot reach upstream; same-state playing screenshot unverified. Catalogue media not exhaustively verified. No PC-independent source. Existing provider cloud denial not bypassed.
Publishing: explicit private config CLI reports sign-in required; default config credential permission error. Do not extract browser cookies/credentials. Browser https://deplexo.com/login requests login; secure auth needed. No production deployment or main merge yet.
Next: authenticate Deplexo, stage v5 and verify browser video advancement, then deploy verified candidate to existing audience. Preserve rollback af8002e and separate original here.now site.

## 2026-11-24 continuation: verified real desktop video
- Local V5 http://127.0.0.1:18092/ HTTP200; /live-media/health and playlist HTTP200.
- Headless Chrome desktop explicit click on Canli yayini baslat produced decoded 1920x1080 image, paused=false readyState=4, video time advanced 0 to 8.08 to 11.24 seconds; screenshot qa-v5-after-click.png confirms actual live frames and 1080p indicator.
- Main V4 production unchanged. Previous autoplay-only playback probe failed to trigger playback; actual user gesture succeeded.
- Still open: full mobile real-playback acceptance; design visual delta from sample; secure Deplexo deployment authorization; source PC must remain running.
- Do not claim V5 published.

## 2026-11-24 V5 design finalization checkpoint (candidate only)
- Final visual: warm ice-blue gradient, floating navigation, watch-first live player, 3 image-led curated cards (KV/Kemal Sunal/Cin), desktop/tablet/mobile CSS without horizontal overflow.
- Real local acceptance: QA qa-v5-final.cjs FINAL_V5_GATE=PASS at 320/390/768/1440. Catalog 8 collections, KV 97 episodes, filter episode 15, next episode, close cleanup. Mobile 390 and desktop 1440 decoded 1920x1080, playback time advanced, zero JS page errors.
- Temporary preview URL: https://poster-festival-having-crossword.trycloudflare.com/ (PC and temporary Cloudflare tunnel dependent), public root, stylesheet, status and HLS health returned HTTP200.
- Public preview playback NOT release-approved: an external mobile Chromium run had delayed advancement, then DEMUXER_ERROR_COULD_NOT_PARSE. Local acceptance success does not prove dependable public streaming. Player now shows a retry error state after decoding failure instead of silently showing pause. Retest required before production deployment.
- Cloud deployment: Deplexo credentials/auth not established; production remains V4 commit af8002e; original here.now separate site unchanged. Need authenticated production deployment and end-to-end public playback soak.
- Restore point: previous V5 commit a4752c7 remains in Git history; this checkpoint is candidate only.
