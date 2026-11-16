#!/bin/sh
# One-time publish from Akhil's Mac: creates the public GitHub repo aageer/speed-decision-2,
# pushes this folder, and deploys web/ to a NEW Vercel project (the midterm site is not touched).
# Run in Terminal:  cd "<this folder>" && ./publish.sh
set -e
cd "$(dirname "$0")"
REPO=aageer/speed-decision-2

if ! command -v gh >/dev/null 2>&1; then echo "GitHub CLI (gh) not found. Install: brew install gh, then: gh auth login"; exit 1; fi
gh auth status >/dev/null 2>&1 || gh auth login

if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Repo $REPO exists; pushing."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" --public --source=. --remote=origin --push \
    --description "The Speed Decision II: what keeps an orbit, and for how long? CPS 5745 Project 2 (Kean University). Ten linked views, real CelesTrak data, two-body, SGP4 and drag models."
fi
gh repo edit "$REPO" --homepage "https://speed-decision-2.vercel.app" --add-topic visualization --add-topic orbital-mechanics --add-topic threejs --add-topic celestrak >/dev/null 2>&1 || true
echo "GitHub: https://github.com/$REPO"

# Vercel: a NEW project named after this folder (speed-decision-2). Asks you to log in the first time.
[ "$(basename "$PWD")" = "speed-decision-2" ] || echo "Note: the Vercel project takes this folder's name: $(basename "$PWD")"
npx --yes vercel@latest deploy --prod --yes
echo "Done. Open https://speed-decision-2.vercel.app (Vercel prints the exact URL above)."
