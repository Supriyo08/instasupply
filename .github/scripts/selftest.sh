#!/usr/bin/env bash
# Runs the two deploy helper scripts against made-up settings and a stand-in for gcloud.
#
# Why: both scripts only ever run for real inside the deploy job, against a live project. A mistake in
# one of them would show up there, as a release that is blocked for no reason or, worse, as one that
# should have been blocked and was not. ci.yml runs this file on every pull request and before every
# deploy. It touches nothing outside a temporary folder and needs no network.
#
#   bash .github/scripts/selftest.sh
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/firebase/functions"

failures=0
check() { # check <what it proves> <expected exit code> <text the output must contain> <command...>
  local name="$1" want="$2" text="$3" output status=0
  shift 3
  output=$("$@" 2>&1) || status=$?
  if [[ "$status" == "$want" && "$output" == *"$text"* ]]; then
    echo "ok    ${name}"
  else
    echo "FAIL  ${name}: exit code ${status} (expected ${want}); the output should contain: ${text}"
    echo "        ${output//$'\n'/$'\n'        }"
    failures=$((failures + 1))
  fi
}

# --- deploy-preflight.sh -------------------------------------------------------------------------

functions_env="$work/firebase/functions/.env.demo-selftest"

preflight() { # preflight [NAME=value ...]: complete, valid production settings, changed by the arguments
  (
    cd "$work"
    env -i PATH="$PATH" GITHUB_OUTPUT=/dev/stdout TARGET=production \
      GCP_WORKLOAD_IDENTITY_PROVIDER=projects/1/locations/global/workloadIdentityPools/github/providers/github \
      GCP_DEPLOY_SERVICE_ACCOUNT=deployer@demo-selftest.iam.gserviceaccount.com \
      FIREBASE_PROJECT_ID=demo-selftest FIREBASE_API_KEY=key FIREBASE_AUTH_DOMAIN=demo-selftest.firebaseapp.com \
      FIREBASE_STORAGE_BUCKET=demo-selftest.firebasestorage.app FIREBASE_APP_ID=1:1:web:1 \
      FUNCTIONS_REGION=northamerica-northeast2 "$@" bash "$here/deploy-preflight.sh"
  )
}

echo 'FUNCTIONS_REGION=northamerica-northeast2' >"$functions_env"
check 'complete production settings pass' 0 'functions_region=northamerica-northeast2' preflight
check 'production without a region stops' 1 'Production has no default region' preflight FUNCTIONS_REGION=
check 'staging without a region stops when the functions deploy elsewhere' 1 'disagree on the region' \
  preflight TARGET=staging FUNCTIONS_REGION=
check 'a region that differs from the functions stops' 1 'disagree on the region' \
  preflight FUNCTIONS_REGION=us-central1
check 'a missing variable is named' 1 'Not set: FIREBASE_API_KEY.' preflight FIREBASE_API_KEY=
check 'a misspelt region stops' 1 'is not a region name' preflight 'FUNCTIONS_REGION=north america'
check 'a project without its functions env file stops' 1 '.env.demo-renamed does not exist' \
  preflight FIREBASE_PROJECT_ID=demo-renamed
check 'something that is not a project id stops' 1 'is not a project id' preflight FIREBASE_PROJECT_ID=../demo
check 'an unknown target stops' 1 'TARGET must be staging or production' preflight TARGET=prod

echo 'FUNCTIONS_REGION="us-central1" # quoted, with a comment' >"$functions_env"
check 'staging without a region falls back to us-central1' 0 'functions_region=us-central1' \
  preflight TARGET=staging FUNCTIONS_REGION=
check 'production gets no such fallback, even where it would fit' 1 'Production has no default region' \
  preflight FUNCTIONS_REGION=

# --- check-storage-rules-access.sh ---------------------------------------------------------------

# Stand-in for gcloud: answers the two calls the script makes.
cat >"$work/bin/gcloud" <<'FAKE'
#!/usr/bin/env bash
case "$1 $2" in
  'projects get-iam-policy')
    if [[ "$FAKE_POLICY" == unreadable ]]; then
      echo 'ERROR: (gcloud.projects.get-iam-policy) PERMISSION_DENIED' >&2
      exit 1
    fi
    printf '%s\n' "$FAKE_POLICY"
    ;;
  'projects describe') echo 123456789012 ;;
  *) exit 2 ;;
esac
FAKE
chmod +x "$work/bin/gcloud"

storage_check() { # storage_check <rules file> <IAM policy as JSON, or "unreadable">
  (
    cd "$work"
    env -i PATH="$work/bin:$PATH" FAKE_POLICY="$2" FIREBASE_PROJECT_ID=demo-selftest \
      bash "$here/check-storage-rules-access.sh" "$1"
  )
}

role='roles/firebaserules.firestoreServiceAgent'
agent='serviceAccount:service-123456789012@gcp-sa-firebasestorage.iam.gserviceaccount.com'
granted='{"bindings":[{"role":"roles/owner","members":["user:owner@example.com"]},{"role":"'$role'","members":["'$agent'"]}]}'
conditional='{"bindings":[{"role":"'$role'","members":["'$agent'"],"condition":{"title":"sometimes","expression":"false"}}]}'
other_account='{"bindings":[{"role":"'$role'","members":["serviceAccount:someone-else@demo-selftest.iam.gserviceaccount.com"]}]}'
other_role='{"bindings":[{"role":"roles/storage.admin","members":["'$agent'"]}]}'
absent='{"bindings":[{"role":"roles/owner","members":["user:owner@example.com"]}]}'

cat >"$work/firebase/lookup.rules" <<'RULES'
service firebase.storage {
  match /b/{bucket}/o {
    match /proofs/{deliveryId}/{file} {
      allow read: if firestore.get(/databases/(default)/documents/deliveries/$(deliveryId)).data.driverId == request.auth.uid;
    }
  }
}
RULES
cat >"$work/firebase/plain.rules" <<'RULES'
service firebase.storage {
  match /b/{bucket}/o {
    // allow read: if firestore.exists(/databases/(default)/documents/users/$(request.auth.uid));
    match /avatars/{uid}/{file} { allow read: if request.auth != null; }
  }
}
RULES

check 'rules without a Firestore lookup need nothing' 0 'does not read Firestore' \
  storage_check firebase/plain.rules "$absent"
check 'a lookup with the role granted passes' 0 "holds ${role}" storage_check firebase/lookup.rules "$granted"
check 'a lookup without the role stops the deploy' 1 'cannot read Firestore in demo-selftest' \
  storage_check firebase/lookup.rules "$absent"
check 'the fix is printed with the real service agent' 1 "--member=${agent} --role=${role} --condition=None" \
  storage_check firebase/lookup.rules "$absent"
check 'a conditional grant does not count' 1 'cannot read Firestore in demo-selftest' \
  storage_check firebase/lookup.rules "$conditional"
check 'the role on some other account does not count' 1 'cannot read Firestore in demo-selftest' \
  storage_check firebase/lookup.rules "$other_account"
check 'some other role on the service agent does not count' 1 'cannot read Firestore in demo-selftest' \
  storage_check firebase/lookup.rules "$other_role"
check 'an unreadable policy warns and lets the deploy continue' 0 'Storage rules access was not checked' \
  storage_check firebase/lookup.rules unreadable
check 'a missing rules file warns and lets the deploy continue' 0 'Storage rules access was not checked' \
  storage_check firebase/missing.rules "$absent"

if ((failures > 0)); then
  echo "${failures} check(s) failed."
  exit 1
fi
echo 'All deploy helper checks passed.'
