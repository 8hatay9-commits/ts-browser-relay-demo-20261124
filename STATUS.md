# V5 checkpoint — 2026-11-24 18:47 TRT
Branch: design/live-stage-v5-20261124. Production remains v4 af8002e.
Implemented light watch-first design, responsive catalogue, inline HLS player, muted autoplay, actual decoded height indicator, retry, mobile 230px stage minimum and constrained width; corrected pause status.
Verified: Node syntax; DOM initialization, 8 collections, 3 curated covers, 12 previews, search, episode 15/16 navigation, close cleanup.
Remote candidate server http://127.0.0.1:18092: health playing=true current1481 pinned; playlist HTTP200; segment HTTP200 773620 bytes; ffprobe h264 1920x1080.
Cloud browser 390px and 320px iframe viewport QA: widths375/305 excluding scrollbars, scroll widths match; mobile clipping fixed. Not physical-device testing.
Blocked: cloud preview cannot reach upstream; same-state playing screenshot unverified. Catalogue media not exhaustively verified. No PC-independent source. Existing provider cloud denial not bypassed.
Publishing: explicit private config CLI reports sign-in required; default config credential permission error. Do not extract browser cookies/credentials. Browser https://deplexo.com/login requests login; secure auth needed. No production deployment or main merge yet.
Next: authenticate Deplexo, stage v5 and verify browser video advancement, then deploy verified candidate to existing audience. Preserve rollback af8002e and separate original here.now site.
