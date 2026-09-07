# Reviewed source snapshot

This independent branch contains the reviewed application source as of 2026-09-07, including move review, authenticated teaching-video playback, interface changes, tests, and public lesson metadata. The original working branch and its Git history remain unchanged.

The repository contains no local learning records, private runtime configuration, original images or videos, raw SGF source archive, or earlier Git history. The local validation journal is replaced with the publication checks below. No deployment or release is performed by creating this branch.

Before deploying, replace the zero account/database IDs and `go.example.com` in `wrangler.jsonc` with your own resources, and supply secrets through the documented private configuration. Two unit-test credential fixtures use explicit placeholders; a synthetic credential-bearing negative URL is constructed inside its isolated test. Application data are public or authored practice problems, not learner records.

Go Game Guru lesson data and the converted author-refutation variations retain author attribution, original source URLs and CC BY-NC-SA-4.0 licensing. The upstream license is in `data/gogameguru/UPSTREAM_LICENSE`. Raw upstream SGF files are omitted; they are needed only when rebuilding those derived data, not for ordinary practice. Teaching-video JSON contains public author metadata and application routes; no media bytes are included and this snapshot does not grant redistribution rights to videos.

## Publication verification

The affected local review and bridge tests passed (26 Python tests), and the affected cloud review, video and worker tests passed (27 Node tests), with temporary learning data and mocked engines. Additional checks on the exported source are recorded in `验证记录.md`.
