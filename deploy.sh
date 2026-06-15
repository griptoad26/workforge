#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# deploy.sh — Push the seele.agency sales site to GitHub Pages
#
# This is the only thing you need to run to update seele.agency.
# Pre-requisites:
#   1. A working GitHub personal access token with `repo` + `workflow` scopes
#      Get one: https://github.com/settings/tokens
#   2. The token in ~/.git-credentials as:
#      https://<TOKEN>@github.com
#   3. Or use `gh auth login` (interactive)
#
# Usage:
#   ./deploy.sh                  # normal: commit + push
#   ./deploy.sh --msg "msg"      # custom commit message
#   ./deploy.sh --dry-run        # show what would happen, don't push
#   ./deploy.sh --force          # force-push (use carefully)
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Resolve script dir
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Args
MSG="Update seele.agency sales site ($(date +%Y-%m-%d))"
DRY_RUN="false"
FORCE="false"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --msg) MSG="$2"; shift 2 ;;
        --dry-run) DRY_RUN="true"; shift ;;
        --force) FORCE="true"; shift ;;
        -h|--help)
            head -20 "$0"
            exit 0 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ── 1. Sanity ───────────────────────────────────────────────────────────
echo "→ Repo: $(git remote -v | head -1)"
echo "→ Branch: $(git branch --show-current)"

if ! git remote -v | grep -q "github.com"; then
    echo "✗ No GitHub remote. This script only works for github.com remotes."
    exit 1
fi

# ── 2. Working tree ─────────────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
    echo "→ Uncommitted changes:"
    git status --short
    echo
    if [ "$DRY_RUN" = "true" ]; then
        echo "DRY-RUN: would commit with message: $MSG"
    else
        git add -A
        git commit -m "$MSG"
    fi
else
    echo "→ Working tree clean."
fi

# ── 3. Push ────────────────────────────────────────────────────────────
AHEAD=$(git rev-list --count origin/main..main 2>/dev/null || echo "0")
echo "→ Commits ahead of origin/main: $AHEAD"

if [ "$AHEAD" = "0" ]; then
    echo "✓ Nothing to push. Site is already up to date."
    exit 0
fi

if [ "$DRY_RUN" = "true" ]; then
    echo "DRY-RUN: would push $AHEAD commit(s) to origin/main"
    git log --oneline origin/main..main
    exit 0
fi

echo "→ Pushing $AHEAD commit(s) to origin/main ..."
if [ "$FORCE" = "true" ]; then
    git push --force-with-lease origin main
else
    git push origin main
fi

# ── 4. Wait for GitHub Pages rebuild ────────────────────────────────────
echo
echo "→ GitHub Pages will rebuild in ~30s."
echo "→ Watch: https://github.com/griptoad26/workforge/actions"
echo
echo "✓ Done! Check:"
echo "    https://seele.agency/"
echo "    https://seele.agency/downloads.html"
echo "    https://seele.agency/support.html"
echo "    https://seele.agency/addons.html"
echo "    https://seele.agency/checkout.html"
