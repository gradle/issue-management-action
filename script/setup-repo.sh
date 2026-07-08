#!/usr/bin/env bash
set -euo pipefail

# Sets up issue-management automation in a repository.
# 1. Verifies the target repo exists and is accessible.
# 2. Asks whether to add the triage-queue workflow and/or the feedback workflow.
# 3. Opens a PR adding the selected workflow files (sourced from this repo).
# 4. Ensures the labels those workflows rely on exist. This step is tolerant to
#    failures: any label that cannot be created is listed at the end so a repo
#    admin can add it manually.
#
# Usage:
#   script/setup-repo.sh <repo>
# where <repo> is one of:
#   - owner/name
#   - https://github.com/owner/name (optionally with a trailing path or .git)
#   - git@github.com:owner/name.git

OFF='\033[0m'
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOWS_DIR="$SCRIPT_DIR/../.github/workflows"

# Populated by select_workflows.
workflows=()
labels=()

# Set by open_pr; cleaned up on exit.
tmp=""
ssh_ctl=""

cleanup() {
  [[ -n "$tmp" ]] && rm -rf "$tmp"
  if [[ -n "$ssh_ctl" ]]; then
    ssh -o ControlPath="$ssh_ctl" -O exit github.com >/dev/null 2>&1 || true
    rm -f "$ssh_ctl"
  fi
  return 0
}
trap cleanup EXIT

die() {
  echo -e "${RED}Error:${OFF} $*" >&2
  exit 1
}

ask() {
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# entry "name|color|desc" -> sets L_NAME, L_COLOR, L_DESC
split_label() {
  local rest
  L_NAME="${1%%|*}"
  rest="${1#*|}"
  L_COLOR="${rest%%|*}"
  L_DESC="${rest#*|}"
}

require_tools() {
  command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is required"
  command -v git >/dev/null 2>&1 || die "git is required"
}

# Route git's SSH transport through a single shared connection so the clone,
# branch check, and push authenticate at most once instead of re-prompting for
# the key passphrase each time. Best-effort: if the repo is cloned over HTTPS
# the SSH command is never invoked, and if ssh is missing this is a no-op.
enable_ssh_multiplexing() {
  command -v ssh >/dev/null 2>&1 || return 0
  # Keep the socket path short (< ~104 chars) to stay under the unix-socket limit.
  ssh_ctl="/tmp/gh-setup-repo-ssh-$$.sock"
  export GIT_SSH_COMMAND="ssh -o ControlMaster=auto -o ControlPath=$ssh_ctl -o ControlPersist=600"
}

# Parse any accepted form into "owner/name" and verify it is accessible.
resolve_repo() {
  [[ $# -eq 1 ]] || die "usage: script/setup-repo.sh <repo>"

  local slug="$1" owner name
  slug="${slug#https://github.com/}"
  slug="${slug#http://github.com/}"
  slug="${slug#git@github.com:}"
  slug="${slug%.git}"
  slug="${slug#/}"

  [[ "$slug" == */* ]] || die "repository must be given as 'owner/name' or a GitHub URL, got '$1'"
  owner="${slug%%/*}"
  name="${slug#*/}"
  name="${name%%/*}" # drop any trailing path segments (e.g. /issues, /tree/main)
  [[ -n "$owner" && -n "$name" ]] || die "could not parse 'owner/name' from '$1'"
  repo="$owner/$name"

  echo -e "Checking ${BLUE}$repo${OFF} ..."
  gh api "repos/$repo" --jq '.full_name' >/dev/null 2>&1 ||
    die "repository '$repo' not found or not accessible"
  echo -e "${GREEN}OK${OFF} — $repo is accessible"
}

# Prompt for the workflows to add and collect their files and labels.
# Colors and descriptions mirror the labels in gradle/gradle.
select_workflows() {
  local add_triage=false add_feedback=false
  ask "Add the triage-queue workflow (triage-label.yml)?" && add_triage=true
  ask "Add the feedback workflow (feedback.yml)?" && add_feedback=true

  if $add_triage; then
    workflows+=("triage-label.yml")
    labels+=(
      "to-triage|8F1E92|"
      "from:contributor|24D2A8|PR by an external contributor"
    )
  fi

  if $add_feedback; then
    workflows+=("feedback.yml")
    labels+=(
      "to-triage|8F1E92|"
      ":wave: team-triage|8F1E92|Issues that need to be triaged by a specific team"
      "pending:reproducer|E3A622|Indicates that the issue requires a reproducer or will be closed after 7 days"
      "pending:feedback|E3A622|Indicates that changes or additional info are required, and the issue will be closed without them"
      "pending:dco|E3A622|PR DCO check is failing, commits need to be signed off"
      "closed:unreproducible|E3A622|Unable to reproduce with given information"
      "closed:missing-feedback|E3A622|Feedback was requested but not provided in time"
      "closed:missing-dco|E3A622|Some PR commits are missing a valid signature"
    )
  fi

  [[ ${#workflows[@]} -gt 0 ]]
}

# Clone the repo, add the selected workflows, and open a PR (unless unchanged).
open_pr() {
  local default_branch gh_login branch force existing_pr pr_body pr_url wf list
  tmp="$(mktemp -d)"

  enable_ssh_multiplexing
  echo -e "Cloning ${BLUE}$repo${OFF} ..."
  gh repo clone "$repo" "$tmp" -- --depth 1 --quiet

  default_branch="$(gh repo view "$repo" --json defaultBranchRef --jq '.defaultBranchRef.name')"
  gh_login="$(gh api user --jq '.login')"
  branch="$gh_login/add-issue-management-workflows"

  git -C "$tmp" checkout -q -b "$branch"
  mkdir -p "$tmp/.github/workflows"
  for wf in "${workflows[@]}"; do
    cp "$WORKFLOWS_DIR/$wf" "$tmp/.github/workflows/$wf"
    git -C "$tmp" add ".github/workflows/$wf"
  done

  if git -C "$tmp" diff --cached --quiet; then
    echo -e "${YELLOW}No changes${OFF} — the selected workflow(s) already match $repo. Skipping PR."
    return
  fi

  git -C "$tmp" commit -q -s -m "Add issue management workflows"

  force=""
  echo -e "Checking whether branch ${BLUE}$branch${OFF} exists on the remote ..."
  if git -C "$tmp" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    ask "Branch '$branch' already exists on the remote. Force-push over it?" ||
      die "aborted: not overwriting existing branch '$branch'"
    force="--force"
  fi
  echo -e "Pushing branch ${BLUE}$branch${OFF} ..."
  git -C "$tmp" push -q $force -u origin "$branch"

  existing_pr="$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url')"
  if [[ -n "$existing_pr" ]]; then
    echo -e "${GREEN}PR updated:${OFF} $existing_pr"
  else
    list=""
    for wf in "${workflows[@]}"; do
      list+="- \`.github/workflows/$wf\`"$'\n'
    done
    pr_body="Adds the following issue-management workflow(s):
$list"
    pr_url="$(gh pr create --repo "$repo" --base "$default_branch" --head "$branch" \
      --assignee @me --title "Add issue management workflows" --body "$pr_body")"
    echo -e "${GREEN}PR created:${OFF} $pr_url"
  fi
}

# Create any missing labels; tolerant of failures, which are reported at the end.
ensure_labels() {
  local existing seen="" failed=() entry err rc
  echo -e "\nEnsuring labels exist ..."
  existing="$(gh label list --repo "$repo" --limit 500 --json name --jq '.[].name' 2>/dev/null || true)"

  for entry in "${labels[@]}"; do
    split_label "$entry"
    case "|$seen|" in *"|$L_NAME|"*) continue ;; esac # dedup across workflows
    seen="$seen|$L_NAME"

    if printf '%s\n' "$existing" | grep -Fxq "$L_NAME"; then
      echo -e "  ${BLUE}exists${OFF}   $L_NAME"
      continue
    fi

    err="$(gh label create "$L_NAME" --repo "$repo" --color "$L_COLOR" --description "$L_DESC" 2>&1)" && rc=0 || rc=$?
    if [[ $rc -eq 0 ]]; then
      echo -e "  ${GREEN}created${OFF}  $L_NAME"
    elif [[ "$err" == *"already exists"* ]]; then
      echo -e "  ${BLUE}exists${OFF}   $L_NAME"
    else
      echo -e "  ${RED}failed${OFF}   $L_NAME"
      failed+=("$entry")
    fi
  done

  if [[ ${#failed[@]} -gt 0 ]]; then
    echo -e "\n${YELLOW}Some labels could not be created${OFF} (likely insufficient permissions)."
    echo "Ask a repo admin to create them manually:"
    for entry in "${failed[@]}"; do
      split_label "$entry"
      echo "  - name: \"$L_NAME\"  color: #$L_COLOR  description: \"$L_DESC\""
    done
  fi
}

main() {
  require_tools
  resolve_repo "$@"
  if ! select_workflows; then
    echo "Nothing selected. Exiting."
    exit 0
  fi
  open_pr
  ensure_labels
  echo -e "\n${GREEN}Done.${OFF}"
}

main "$@"
