#!/bin/sh
# Rebuild the page data from the hashed raw snapshots, run the checks, and serve.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
.venv/bin/python -m pipeline.prepare
.venv/bin/python pipeline/verify.py
echo "Open http://127.0.0.1:8746/"
exec .venv/bin/python -m http.server 8746 --directory web
