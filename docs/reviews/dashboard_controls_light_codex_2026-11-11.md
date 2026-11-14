# Codex — dashboard controls, trace and light theme

- Added per-run Validate and Chấm điểm local buttons. Both run without Colab/model inference, on completed/failed jobs. Public scoring is disabled without ground truth.
- `dashboard_review.py` replays saved predictions, validates the actual downloadable file when present, and recomputes TRAIN strict F1/sequence/hash against dataset labels. Reports persist as manual-validation.json and local-score.json. Invalid validation revokes the download gate; manual review never promotes an incomplete run to a ready submission.
- History reads recomputed evaluations.json; default chart is strict tool F1 × 100, labelled diagnostic rather than official ZAIC. Gold/audio and different sample cohorts remain separate. Existing real run v0-20 appears as two branch points in the browser.
- Live F1 no longer depends on a weighted local score existing. Model responses and rejected argument payloads are visible; diagnostic flags can use observed sequence/hash mismatch without inventing task success.
- Light theme uses readable 14px body, larger labels, white panels, darker text and semantic colors. Browser widths 1440 and 390 have no document-level horizontal overflow.
- Frontend build and 41 unit tests passed. Seven Python lifecycle/review tests passed; three targeted browser tests passed, including the new validate/score controls, default local chart, and run comparisons. Earlier full Python suite passed 29 tests before the two manual-review tests were added.

No inference was started for these UI changes. p1 has trained on all TRAIN, so these metrics do not establish hidden-test performance. No official aggregate score formula is introduced.
