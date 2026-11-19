#!/usr/bin/env bash
# Stand-in for the Firebase CLI, used only by infra/selftest.sh. It shares $FAKE_STATE with
# fake-gcloud.sh and fake-curl.sh and copies the three behaviours of the real CLI that the
# bootstrap exists to get ahead of:
#   - a Firestore deploy to a project without a database creates one in nam5
#   - a Storage deploy to a project without a default bucket stops
#   - a Storage deploy never grants the role that lets rules read Firestore
#
# Extra files in $FAKE_STATE
#   firebase_signed_in    the CLI has its own sign-in
#   taken_sites           Hosting site names that belong to someone else
set -u

STATE="$FAKE_STATE"
echo "firebase $* [in ${PWD}]" >>"$FAKE_LOG"
number="$(cat "${STATE}/project_number")"
project="$(cat "${STATE}/project_id")"

case "$1" in
  apps:list)
    if [[ ! -f "${STATE}/firebase_signed_in" ]]; then
      echo 'Error: Failed to authenticate, have you run firebase login?'
      exit 1
    fi
    echo 'No apps found.'
    ;;
  hosting:sites:create)
    if grep -qxF "$2" "${STATE}/taken_sites" 2>/dev/null; then
      echo "Error: Invalid name: \`$2\` is reserved by another project; try something like \`$2-abc12\`" >&2
      exit 1
    fi
    if [[ -f "${STATE}/hosting_site" ]]; then
      echo 'Error: the project already has a default site' >&2
      exit 1
    fi
    echo "$2" >"${STATE}/hosting_site"
    echo "Site $2 has been created"
    ;;
  deploy)
    if [[ ! -f firebase.json ]]; then
      echo 'Error: Not in a Firebase app directory (could not locate firebase.json)' >&2
      exit 1
    fi
    case "$*" in
      *'--only firestore'*)
        if [[ ! -f "${STATE}/database" ]]; then
          printf 'nam5\tFIRESTORE_NATIVE\tPOINT_IN_TIME_RECOVERY_DISABLED\tDELETE_PROTECTION_DISABLED\n' >"${STATE}/database"
          echo 'THE DEPLOY CREATED A DATABASE IN nam5' >>"$FAKE_LOG"
        fi
        {
          printf 'projects/%s/databases/(default)/collectionGroups/otpChallenges/fields/expiresAt\tCREATING\n' "$project"
          printf 'projects/%s/databases/(default)/collectionGroups/rateLimits/fields/expiresAt\tACTIVE\n' "$project"
        } >"${STATE}/ttl"
        echo 'Deploy complete (firestore)'
        ;;
      *'--only storage'*)
        if [[ ! -f "${STATE}/bucket" ]]; then
          echo 'Error: Firebase Storage has not been set up on this project.' >&2
          exit 1
        fi
        grep -qxF "roles/firebaserules.firestoreServiceAgent serviceAccount:service-${number}@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
          "${STATE}/policy/project" 2>/dev/null ||
          echo 'STORAGE RULES WENT OUT WITHOUT THE FIRESTORE ROLE' >>"$FAKE_LOG"
        echo 'Deploy complete (storage)'
        ;;
      *)
        echo "UNEXPECTED firebase $*" >>"$FAKE_LOG"
        exit 97
        ;;
    esac
    ;;
  functions:artifacts:setpolicy)
    echo 'Cleanup policy set'
    ;;
  *)
    echo "UNEXPECTED firebase $*" >>"$FAKE_LOG"
    exit 97
    ;;
esac
