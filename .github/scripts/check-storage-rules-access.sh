#!/usr/bin/env bash
# Stops a deploy whose Storage rules cannot work in the target project.
#
# Why: Storage rules that call firestore.get() or firestore.exists() are evaluated by the project's
# Cloud Storage for Firebase service agent, and that account needs the role
# roles/firebaserules.firestoreServiceAgent. The Firebase CLI only offers to grant it in an
# interactive prompt; a --non-interactive deploy, which is all CI ever runs, skips the question
# without a word. Without the role every such rule denies in production, while the emulator (which
# has no IAM) and the rules tests keep passing.
#
# The role is granted once per project by a project Owner (infra/bootstrap-project.sh). The CI
# deployer must not be able to change IAM, so this script only looks. It stops the deploy when the
# role is definitely missing and warns, without stopping, when it cannot find out.
#
#   FIREBASE_PROJECT_ID=my-project bash .github/scripts/check-storage-rules-access.sh [rules file]
#
# Needs gcloud and jq, with gcloud already signed in (google-github-actions/auth does that in CI).
set -euo pipefail

rules_file="${1:-firebase/storage.rules}" # `storage.rules` in firebase.json
project="${FIREBASE_PROJECT_ID:?Set FIREBASE_PROJECT_ID to the Firebase project id}"
role="roles/firebaserules.firestoreServiceAgent"
agent_pattern='^serviceAccount:service-[0-9]+@gcp-sa-firebasestorage\.iam\.gserviceaccount\.com$'

not_checked() { # not_checked <reason>: say so and let the deploy continue
  echo "::warning title=Storage rules access was not checked::$1 If uploads that the rules should allow fail with storage/unauthorized after this deploy, the Storage service agent is missing ${role}."
  exit 0
}

[[ -f "$rules_file" ]] || not_checked "${rules_file} does not exist."

# The same test the Firebase CLI uses to decide whether the role is needed (rulesDeploy.js), except
# that lines which are only a comment do not count. awk exits 0 for "reads Firestore", 1 for "does not".
scan=0
awk '!/^[ \t]*\/\// && /firestore\.(get|exists)/ { found = 1 } END { exit !found }' "$rules_file" || scan=$?
if [[ "$scan" == 1 ]]; then
  echo "${rules_file} does not read Firestore, so the Storage service agent needs no extra role."
  exit 0
elif [[ "$scan" != 0 ]]; then
  not_checked "${rules_file} could not be scanned."
fi

for tool in gcloud jq; do
  command -v "$tool" >/dev/null 2>&1 || not_checked "${tool} is not installed on this runner."
done
export CLOUDSDK_CORE_DISABLE_PROMPTS=1 # gcloud must fail, never wait for an answer

if ! policy=$(gcloud projects get-iam-policy "$project" --format=json); then
  not_checked "Could not read the IAM policy of ${project} (gcloud's own message is in this step's log)."
fi

# A conditional binding does not count: the rules engine needs the role on every request.
result=0
jq -e --arg role "$role" --arg agent "$agent_pattern" \
  'any(.bindings[]?; .role == $role and .condition == null and any(.members[]?; test($agent)))' \
  <<<"$policy" >/dev/null || result=$?

case "$result" in
  0)
    echo "${rules_file} reads Firestore, and the Storage service agent of ${project} holds ${role}."
    ;;
  1)
    number=$(gcloud projects describe "$project" --format='value(projectNumber)' 2>/dev/null || true)
    agent="service-${number:-PROJECT_NUMBER}@gcp-sa-firebasestorage.iam.gserviceaccount.com"
    echo "A project Owner can grant the role with:"
    echo "  gcloud projects add-iam-policy-binding ${project} --member=serviceAccount:${agent} --role=${role} --condition=None"
    echo "::error title=The Storage rules cannot read Firestore in ${project}::${rules_file} reads Firestore, but ${agent} does not hold ${role}, so every rule that does a lookup would deny. A project Owner has to grant the role once (infra/bootstrap-project.sh, or the gcloud command in this step's log). Nothing was deployed; re-run this job afterwards."
    exit 1
    ;;
  *)
    not_checked "The IAM policy of ${project} could not be read as JSON."
    ;;
esac
