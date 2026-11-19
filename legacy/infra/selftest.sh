#!/usr/bin/env bash
# Runs bootstrap-project.sh against stand-ins for gcloud, curl and the Firebase CLI.
#
#   bash infra/selftest.sh             # with the bash that runs this file
#   bash infra/selftest.sh /bin/bash   # with another one (macOS ships bash 3.2 there)
#
# Why: the bootstrap only ever runs for real against a live project, once, as an Owner. A mistake in
# it shows up there, as a database in the wrong country or a deploy account that cannot deploy. This
# file runs it from many starting points (a new project, a second run, a project set up by the old
# script, wrong locations, missing sign-ins) and checks what it did and in which order.
#
# What it proves: the script's own logic, its order of steps, and that it works on bash 3.2 and
# newer. What it cannot prove: that Google's tools behave like the stand-ins in infra/selftest/.
# Those copy what the documentation and the Firebase CLI's source say.
#
# It needs node on the PATH, touches nothing outside a temporary folder and uses no network.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shell="${1:-$BASH}"
if ! command -v node >/dev/null 2>&1; then
  echo 'node is not on the PATH. The bootstrap script needs it, and so does this test.' >&2
  exit 1
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A pretend checkout, so the script finds "its" Firebase CLI and firebase.json next to itself.
checkout="${work}/checkout"
mkdir -p "${work}/bin" "${checkout}/infra" "${checkout}/node_modules/.bin" "${checkout}/firebase/functions"
cp "${here}/bootstrap-project.sh" "${checkout}/infra/bootstrap-project.sh"
cp "${here}/selftest/fake-gcloud.sh" "${work}/bin/gcloud"
cp "${here}/selftest/fake-curl.sh" "${work}/bin/curl"
cp "${here}/selftest/fake-sleep.sh" "${work}/bin/sleep"
cp "${here}/selftest/fake-firebase.sh" "${checkout}/node_modules/.bin/firebase"
chmod +x "${work}/bin/gcloud" "${work}/bin/curl" "${work}/bin/sleep" "${checkout}/node_modules/.bin/firebase"
echo '{}' >"${checkout}/firebase.json"
search_path="${work}/bin:$(dirname "$(command -v node)"):/usr/bin:/bin"

project='instasupply-selftest'
number='123456789012'
functions_account="${number}-compute@developer.gserviceaccount.com"
deployer="instasupply-deployer@${project}.iam.gserviceaccount.com"
storage_agent="service-${number}@gcp-sa-firebasestorage.iam.gserviceaccount.com"
pubsub_agent="service-${number}@gcp-sa-pubsub.iam.gserviceaccount.com"
pool="projects/${number}/locations/global/workloadIdentityPools/github"
env_file="${checkout}/firebase/functions/.env.${project}"
shared_env_file="${checkout}/firebase/functions/.env"

projects=0
status=0
FAKE_STATE=''
FAKE_LOG=''
output=''

# new_project: a project as the Firebase console leaves it. On the Blaze plan, Firebase added, the
# caller is an Owner and signed in to both tools, and nothing else exists yet.
new_project() {
  projects=$((projects + 1))
  FAKE_STATE="${work}/project-${projects}"
  FAKE_LOG="${FAKE_STATE}.log"
  output="${FAKE_STATE}.out"
  mkdir -p "${FAKE_STATE}/accounts" "${FAKE_STATE}/slow_accounts"
  : >"$FAKE_LOG"
  echo 'owner@example.com' >"${FAKE_STATE}/account"
  echo "$project" >"${FAKE_STATE}/project_id"
  echo "$number" >"${FAKE_STATE}/project_number"
  echo 'True' >"${FAKE_STATE}/billing"
  touch "${FAKE_STATE}/owner" "${FAKE_STATE}/firebase_signed_in" "${FAKE_STATE}/accounts/${functions_account}"
  printf 'FUNCTIONS_REGION=northamerica-northeast2\nMANAGED_SECRETS=GOOGLE_MAPS_API_KEY,TWILIO_AUTH_TOKEN,OTP_PEPPER\n' >"$env_file"
  : >"$shared_env_file"
}

# An older project already has its APIs on, which is what lets the bootstrap see what is in it.
with_apis_on() {
  printf '%s\n' serviceusage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com \
    firebase.googleapis.com firestore.googleapis.com firebasestorage.googleapis.com \
    firebasehosting.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com >>"${FAKE_STATE}/apis"
}

# without <file>: takes one piece of the project away. The stand-ins only look at exact names.
without() { mv "${FAKE_STATE}/$1" "${FAKE_STATE}/$1.away"; }

# run [NAME=value ...] -- <arguments of bootstrap-project.sh>
# Output lands in $output, the exit code in $status, the calls it made in $FAKE_LOG.
run() {
  local settings=()
  while [[ "$1" != '--' ]]; do
    settings+=("$1")
    shift
  done
  shift
  : >"$FAKE_LOG"
  status=0
  env -i PATH="$search_path" HOME="$work" FAKE_STATE="$FAKE_STATE" FAKE_LOG="$FAKE_LOG" \
    ${settings[@]+"${settings[@]}"} "$shell" "${checkout}/infra/bootstrap-project.sh" "$@" \
    >"$output" 2>&1 </dev/null || status=$?
}

passed=0
failed=0
check() { # check <what it proves> <command that must succeed...>
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    passed=$((passed + 1))
    echo "ok    ${name}"
  else
    failed=$((failed + 1))
    echo "FAIL  ${name}"
    echo "        output: ${output}"
    echo "        calls:  ${FAKE_LOG}"
  fi
}

stopped() { [[ "$status" == 1 ]]; }
finished() { [[ "$status" == 0 ]]; }
said() { grep -qF -- "$1" "$output"; }
did_not_say() { ! grep -qF -- "$1" "$output"; }
called() { grep -qF -- "$1" "$FAKE_LOG"; }
did_not_call() { ! grep -qF -- "$1" "$FAKE_LOG"; }
granted() { grep -qxF -- "$2 $3" "${FAKE_STATE}/policy/$1"; } # granted <policy> <role> <member>
not_granted() { ! grep -qxF -- "$2 $3" "${FAKE_STATE}/policy/$1" 2>/dev/null; }
line_of() { grep -nF -- "$1" "$FAKE_LOG" | head -n 1 | cut -d: -f1; }
came_before() { # came_before <call> <later call>
  local first second
  first="$(line_of "$1")"
  second="$(line_of "$2")"
  [[ -n "$first" && -n "$second" ]] && ((first < second))
}
changed_nothing() {
  ! grep -qE '(services enable| create|add-iam-policy-binding|remove-iam-policy-binding|versions add| update|undelete|curl POST https://firebasestorage|firebase deploy|hosting:sites:create|setpolicy)' "$FAKE_LOG"
}
went_as_planned() { # nothing the stand-ins did not expect, and none of the mistakes they watch for
  ! grep -qE '^(UNEXPECTED|TOKEN ON THE COMMAND LINE|NO TOKEN ON STDIN|THE DEPLOY CREATED|STORAGE RULES WENT OUT)' "$FAKE_LOG"
}
is_one_newline() { [[ "$(od -An -c "$1" | tr -d ' ')" == '\n' ]]; }
versions_of() { find "${FAKE_STATE}/secrets/$1" -type f | wc -l | tr -d ' '; }
has_versions() { [[ "$(versions_of "$1")" == "$2" ]]; }

echo "Shell under test: $("$shell" --version | head -n 1)"

# --- A new project ----------------------------------------------------------------------------------
echo
echo 'A new project'
new_project
run -- --yes "$project"
check 'runs from start to finish' finished
check 'makes no call the stand-ins do not expect, and never puts the token on a command line' went_as_planned
check 'creates the database in Toronto, with recovery and delete protection' called \
  'firestore databases create --database=(default) --location=northamerica-northeast2 --type=firestore-native --enable-pitr --delete-protection'
check 'creates the database before any firebase deploy could create one in nam5' came_before \
  'firestore databases create' 'firebase deploy'
check 'schedules daily backups kept for 14 days' called \
  'backups schedules create --database=(default) --recurrence=daily --retention=14d'
check 'creates the default bucket in Toronto' called "curl POST https://firebasestorage.googleapis.com/v1alpha/projects/${project}/defaultBucket {\"location\":\"northamerica-northeast2\"}"
check 'creates the Hosting site before switching on Authentication, which would name it itself' came_before \
  "hosting:sites:create ${project}" 'identitytoolkit.googleapis.com'
check 'switches on Cloud Billing, which every functions deploy asks' grep -qxF cloudbilling.googleapis.com "${FAKE_STATE}/apis"
check 'lets Storage rules read Firestore' granted project roles/firebaserules.firestoreServiceAgent "serviceAccount:${storage_agent}"
check 'does that before the Storage rules go out' came_before 'roles/firebaserules.firestoreServiceAgent' '--only storage'
check 'gives Pub/Sub the grant a first trigger deploy needs' granted project roles/iam.serviceAccountTokenCreator "serviceAccount:${pubsub_agent}"
check 'lets the functions account call functions' granted project roles/run.invoker "serviceAccount:${functions_account}"
check 'lets the functions account receive events' granted project roles/eventarc.eventReceiver "serviceAccount:${functions_account}"
check 'lets the functions account build' granted project roles/cloudbuild.builds.builder "serviceAccount:${functions_account}"
for secret in GOOGLE_MAPS_API_KEY TWILIO_AUTH_TOKEN OTP_PEPPER; do
  check "lets the functions read ${secret}, with a grant on the secret itself" granted "secret/${secret}" \
    roles/secretmanager.secretAccessor "serviceAccount:${functions_account}"
done
check 'stores a secret nobody has a value for as one newline' is_one_newline "${FAKE_STATE}/secrets/GOOGLE_MAPS_API_KEY/1"
check 'never stores the word "unset"' bash -c "! grep -rqx unset '${FAKE_STATE}/secrets'"
check 'generates the OTP pepper: 64 hex characters' grep -qE '^[0-9a-f]{64}$' "${FAKE_STATE}/secrets/OTP_PEPPER/1"
check 'says what an unset secret means' said 'GOOGLE_MAPS_API_KEY has no value, so address search uses OpenStreetMap'
check 'lets the deployer act as the functions account' granted "account/${functions_account}" roles/iam.serviceAccountUser "serviceAccount:${deployer}"
check 'does not let the deployer act as every account in the project' not_granted project roles/iam.serviceAccountUser "serviceAccount:${deployer}"
check 'gives the deployer no role that can change access' bash -c "! grep -E 'Owner|owner|IamAdmin|securityAdmin|secretmanager.admin' '${FAKE_STATE}/policy/project'"
check 'publishes Firestore and Storage separately, from the repository root' bash -c \
  "grep -qF -- '--only firestore --non-interactive [in ${checkout}]' '${FAKE_LOG}' && grep -qF -- '--only storage --non-interactive [in ${checkout}]' '${FAKE_LOG}'"
check 'reads the TTL policies back' said 'TTL policy on otpChallenges.expiresAt'
check 'does not pretend to set an image cleanup policy before there are images' bash -c \
  "! grep -qF setpolicy '${FAKE_LOG}' && grep -qF 'No functions have been deployed' '${output}'"
check 'sets up no GitHub sign-in without being told which repository' did_not_call 'workload-identity-pools create'
check 'prints the bucket name the client builds need' said "FIREBASE_STORAGE_BUCKET          ${project}.firebasestorage.app"
cp "${FAKE_STATE}/secrets/OTP_PEPPER/1" "${FAKE_STATE}.pepper"
cp "${FAKE_STATE}/policy/project" "${FAKE_STATE}.policy"

echo
echo 'A second run on the same project, after the first functions deploy'
touch "${FAKE_STATE}/image_repository"
run -- --yes "$project"
check 'runs from start to finish' finished
check 'makes no unexpected call' went_as_planned
check 'creates nothing twice and takes nothing away' bash -c \
  "! grep -qE '(databases create|databases update|schedules create|curl POST https://firebasestorage|secrets create|versions add|service-accounts create|hosting:sites:create|remove-iam-policy-binding)' '${FAKE_LOG}'"
check 'leaves the OTP pepper alone' cmp -s "${FAKE_STATE}/secrets/OTP_PEPPER/1" "${FAKE_STATE}.pepper"
check 'leaves the project policy as it was' cmp -s "${FAKE_STATE}/policy/project" "${FAKE_STATE}.policy"
check 'sets the image cleanup policy now that the repository exists' called \
  "functions:artifacts:setpolicy --project ${project} --location northamerica-northeast2 --days 7 --force --non-interactive"

# --- Things that can never be changed afterwards -------------------------------------------------------
echo
echo 'Locations'
new_project
with_apis_on
printf 'nam5\tFIRESTORE_NATIVE\tPOINT_IN_TIME_RECOVERY_DISABLED\tDELETE_PROTECTION_DISABLED\n' >"${FAKE_STATE}/database"
run -- --yes "$project"
check 'a database in another location stops the run' stopped
check 'the message names both locations' said 'is in "nam5", but this run asks for "northamerica-northeast2"'
check 'and says that a location can never be changed' said 'A Firestore location can never be changed'
check 'and that nothing was changed' said 'Nothing was changed.'
check 'and says "Stopped" once' bash -c "[[ \"\$(grep -c 'Stopped\.' '${output}')\" == 1 ]]"
check 'which is true' changed_nothing
run FIRESTORE_LOCATION=nam5 -- --yes "$project"
check 'a multi-region database location needs a bucket location of its own' bash -c \
  "[[ ${status} == 1 && ! -s '${FAKE_LOG}' ]] && grep -qF 'STORAGE_LOCATION=US' '${output}'"
run FIRESTORE_LOCATION=nam5 STORAGE_LOCATION=US -- --yes "$project"
check 'the operator can say that the other location is intended' finished
check 'recovery and delete protection are then turned on for the existing database' called \
  'firestore databases update --database=(default) --enable-pitr --delete-protection'

new_project
with_apis_on
echo "{\"name\":\"projects/${project}/defaultBucket\",\"location\":\"US-CENTRAL1\",\"bucket\":{\"name\":\"projects/${project}/buckets/${project}.appspot.com\"}}" >"${FAKE_STATE}/bucket"
run -- --yes "$project"
check 'a default bucket in another location stops the run' stopped
check 'the message names the bucket and both locations' said "The default bucket ${project}.appspot.com is in \"US-CENTRAL1\", but this run asks for \"northamerica-northeast2\""
check 'nothing was changed' changed_nothing

new_project
with_apis_on
printf 'northamerica-northeast2\tDATASTORE_MODE\tPOINT_IN_TIME_RECOVERY_DISABLED\tDELETE_PROTECTION_DISABLED\n' >"${FAKE_STATE}/database"
run -- --yes "$project"
check 'a Datastore-mode database stops the run' bash -c "[[ ${status} == 1 ]] && grep -qF 'needs Firestore in Native mode' '${output}'"

new_project
run -- --yes "$project" us-central1
check 'a functions region outside Toronto is allowed but pointed out' bash -c "[[ ${status} == 0 ]] && grep -qF 'This run does not' '${output}'"
check 'the data still goes to Toronto' called '--location=northamerica-northeast2 --type=firestore-native'

# --- What the old script and the old instructions left behind ------------------------------------------
echo
echo 'A project set up by the earlier script'
new_project
run -- --yes "$project"
printf 'unset' >"${FAKE_STATE}/secrets/GOOGLE_MAPS_API_KEY/1"
printf 'a-real-token' >"${FAKE_STATE}/secrets/TWILIO_AUTH_TOKEN/1"
{
  echo "roles/iam.serviceAccountUser serviceAccount:${deployer}"
  echo "roles/iam.serviceAccountUser serviceAccount:someone-else@${project}.iam.gserviceaccount.com"
  echo "roles/iam.serviceAccountUserLookalike serviceAccount:${deployer}"
} >>"${FAKE_STATE}/policy/project"
echo ACTIVE >"${FAKE_STATE}/pool"
echo ACTIVE >"${FAKE_STATE}/provider_state"
echo "assertion.repository=='acme/instasupply'" >"${FAKE_STATE}/provider_rule"
{
  echo "roles/iam.workloadIdentityUser principalSet://iam.googleapis.com/${pool}/attribute.repository/acme/instasupply"
  echo 'roles/iam.workloadIdentityUser user:contractor@example.com'
} >>"${FAKE_STATE}/policy/account/${deployer}"
run -- --yes "$project"
check 'runs from start to finish' finished
check 'replaces the "unset" placeholder with one newline' is_one_newline "${FAKE_STATE}/secrets/GOOGLE_MAPS_API_KEY/2"
check 'says that it did' said 'GOOGLE_MAPS_API_KEY held the old placeholder "unset"'
check 'leaves a real secret alone' has_versions TWILIO_AUTH_TOKEN 1
check 'takes away the project-wide right to act as any account' not_granted project roles/iam.serviceAccountUser "serviceAccount:${deployer}"
check 'leaves the same right of other accounts alone' granted project roles/iam.serviceAccountUser "serviceAccount:someone-else@${project}.iam.gserviceaccount.com"
check 'leaves a role with a similar name alone' granted project roles/iam.serviceAccountUserLookalike "serviceAccount:${deployer}"
check 'warns about a GitHub provider it was not asked to check' said "this run did not check it. Its rule is: assertion.repository=='acme/instasupply'"

run GITHUB_REPO_ID=1111 GITHUB_OWNER_ID=2222 GITHUB_DEPLOY_ENVIRONMENT=staging -- --yes "$project"
check 'with the GitHub values, runs from start to finish' finished
check 'the provider now asks for repository, owner, environment and branch' grep -qxF \
  "assertion.repository_id == '1111' && assertion.repository_owner_id == '2222' && assertion.environment == 'staging' && assertion.ref == 'refs/heads/main'" \
  "${FAKE_STATE}/provider_rule"
check 'the existing provider is updated, not created again' called 'providers update-oidc github'
check 'the staging environment may sign in as the deployer' granted "account/${deployer}" roles/iam.workloadIdentityUser \
  "principalSet://iam.googleapis.com/${pool}/attribute.environment/staging"
check 'the old grant to the whole repository is gone' not_granted "account/${deployer}" roles/iam.workloadIdentityUser \
  "principalSet://iam.googleapis.com/${pool}/attribute.repository/acme/instasupply"
check 'a sign-in grant it does not recognise is kept and reported' bash -c \
  "grep -qxF 'roles/iam.workloadIdentityUser user:contractor@example.com' '${FAKE_STATE}/policy/account/${deployer}' && grep -qF 'user:contractor@example.com may also sign in' '${output}'"

echo
echo 'GitHub sign-in on a new project'
new_project
run GITHUB_REPO_ID=1111 GITHUB_OWNER_ID=2222 GITHUB_DEPLOY_ENVIRONMENT=production -- --yes "$project"
check 'runs from start to finish' finished
check 'creates the pool' called 'workload-identity-pools create github --location=global'
check "creates the provider with GitHub's issuer" called \
  'providers create-oidc github --location=global --workload-identity-pool=github --display-name=GitHub Actions --issuer-uri=https://token.actions.githubusercontent.com'
check 'production accepts only release tags' grep -qxF \
  "assertion.repository_id == '1111' && assertion.repository_owner_id == '2222' && assertion.environment == 'production' && assertion.ref.startsWith('refs/tags/v')" \
  "${FAKE_STATE}/provider_rule"
check 'the token fields the rule and the grant use are mapped' grep -qF \
  'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment,attribute.ref=assertion.ref' \
  "${FAKE_STATE}/provider_mapping"
check 'exactly one sign-in grant, for the production environment' bash -c \
  "[[ \"\$(grep -c workloadIdentityUser '${FAKE_STATE}/policy/account/${deployer}')\" == 1 ]] && grep -qF 'attribute.environment/production' '${FAKE_STATE}/policy/account/${deployer}'"
check 'no grant to the repository as a whole' bash -c "! grep -qF 'attribute.repository/' '${FAKE_STATE}/policy/account/${deployer}'"
check 'no longer asks to be run again with the GitHub values' did_not_say 'Run this script again with GITHUB_REPO_ID'

# --- Wrong input and missing sign-ins stop before anything is called or changed ---------------------------
echo
echo 'Stopping early'
new_project
run GITHUB_REPO_ID=1111 -- --yes "$project"
check 'only some of the GitHub values' bash -c "[[ ${status} == 1 && ! -s '${FAKE_LOG}' ]] && grep -qF 'together, or none' '${output}'"
run GITHUB_REPO_ID=acme/instasupply GITHUB_OWNER_ID=acme GITHUB_DEPLOY_ENVIRONMENT=production -- --yes "$project"
check 'names where numeric ids belong' bash -c "[[ ${status} == 1 && ! -s '${FAKE_LOG}' ]] && grep -qF 'numeric ids' '${output}'"
run GITHUB_REPO_ID=1 GITHUB_OWNER_ID=2 "GITHUB_DEPLOY_ENVIRONMENT=x' || true || '" -- --yes "$project"
check 'an environment name that would rewrite the sign-in rule' bash -c "[[ ${status} == 1 && ! -s '${FAKE_LOG}' ]]"
run 'FIRESTORE_LOCATION=nam5","x":"y' -- --yes "$project"
check 'a location that would rewrite the request body' bash -c "[[ ${status} == 1 && ! -s '${FAKE_LOG}' ]]"
run -- --yes demo-instasupply
check 'an emulator-only project id' bash -c "[[ ${status} == 1 && ! -s '${FAKE_LOG}' ]] && grep -qF 'only exists in the emulators' '${output}'"
run -- --yes
check 'no project id: prints the usage, exit code 64' bash -c "[[ ${status} == 64 ]] && grep -qF 'bootstrap-project.sh [--yes] <project-id>' '${output}'"
run -- --help
check '--help prints the header and nothing of the code' bash -c "[[ ${status} == 0 ]] && grep -qF GITHUB_DEPLOY_ENVIRONMENT '${output}' && ! grep -qF 'set -euo' '${output}'"
run -- "$project"
check 'nobody to confirm (not a terminal, no --yes)' bash -c "[[ ${status} == 1 ]] && grep -qF 'run again with --yes' '${output}'"
check 'the plan is shown first' said 'Firestore location   northamerica-northeast2   (can never be changed)'
check 'nothing was changed' changed_nothing

new_project
without firebase_signed_in
run -- --yes "$project"
check 'the Firebase CLI is not signed in' bash -c "[[ ${status} == 1 ]] && grep -qF 'npx firebase login' '${output}'"
check 'nothing was changed' changed_nothing
new_project
without account
run -- --yes "$project"
check 'gcloud is not signed in' bash -c "[[ ${status} == 1 ]] && grep -qF 'gcloud auth login' '${output}'"
new_project
echo 'False' >"${FAKE_STATE}/billing"
run -- --yes "$project"
check 'the project is not on the Blaze plan' bash -c "[[ ${status} == 1 ]] && grep -qF 'not on the Blaze plan' '${output}'"
check 'nothing was changed' changed_nothing
new_project
run -- --yes some-other-project
check 'a project the account cannot see' bash -c "[[ ${status} == 1 ]] && grep -qF 'cannot see a project called' '${output}'"
new_project
touch "${FAKE_STATE}/old_gcloud"
run -- --yes "$project"
check 'a gcloud too old for the commands used' bash -c "[[ ${status} == 1 ]] && grep -qF 'gcloud is too old' '${output}'"
check 'nothing was changed' changed_nothing
new_project
without owner
run -- --yes "$project"
check 'the caller is not an Owner: stops before the first grant' bash -c \
  "[[ ${status} == 1 ]] && grep -qF 'has to be run by a project Owner' '${output}' && ! grep -qF add-iam-policy-binding '${FAKE_LOG}'"

# --- Accounts that Google creates late, or not at all ---------------------------------------------------
echo
echo 'Service accounts'
new_project
without "accounts/${functions_account}"
echo 3 >"${FAKE_STATE}/slow_accounts/${functions_account}"
run -- --yes "$project"
check 'waits for the functions account to appear' bash -c \
  "[[ ${status} == 0 ]] && grep -q '^sleep 10' '${FAKE_LOG}' && ! grep -qF compute.googleapis.com '${FAKE_LOG}'"
new_project
without "accounts/${functions_account}"
run -- --yes "$project"
check 'switches on the Compute Engine API when it never appears' bash -c \
  "[[ ${status} == 0 ]] && grep -qF 'services enable compute.googleapis.com' '${FAKE_LOG}'"
new_project
touch "${FAKE_STATE}/no_storage_agent"
run -- --yes "$project"
check 'no Storage service agent: stops and says what stays broken' bash -c "[[ ${status} == 1 ]] && grep -qF 'Proof-photo uploads stay blocked' '${output}'"
check 'and does not publish Storage rules that cannot work' did_not_call '--only storage'
check 'a stop this late does not claim that nothing was changed' did_not_say 'Nothing was changed.'
new_project
touch "${FAKE_STATE}/accounts/${project}@appspot.gserviceaccount.com"
run -- --yes "$project"
check 'an old App Engine account: the deployer may act as it, as the Firebase CLI insists' granted \
  "account/${project}@appspot.gserviceaccount.com" roles/iam.serviceAccountUser "serviceAccount:${deployer}"

# --- The Hosting site ------------------------------------------------------------------------------------
echo
echo 'Hosting site'
new_project
echo "${project}-ab12c" >"${FAKE_STATE}/hosting_site"
run -- --yes "$project"
check 'an existing site with another name is kept and its address reported' bash -c \
  "[[ ${status} == 0 ]] && ! grep -qF hosting:sites:create '${FAKE_LOG}' && grep -qF 'The web address is https://${project}-ab12c.web.app' '${output}'"
new_project
echo "$project" >"${FAKE_STATE}/hosting_site"
touch "${FAKE_STATE}/site_in_project_record"
run -- --yes "$project"
check 'a site named on the project record needs no second lookup' bash -c \
  "[[ ${status} == 0 ]] && ! grep -qF hosting:sites:create '${FAKE_LOG}' && ! grep -qF 'sites?pageSize' '${FAKE_LOG}'"
new_project
echo "$project" >"${FAKE_STATE}/taken_sites"
run -- --yes "$project"
check 'a taken name stops the run before Authentication could pick a name' bash -c \
  "[[ ${status} == 1 ]] && grep -qF 'HOSTING_SITE_ID=<name>' '${output}' && ! grep -qF identitytoolkit '${FAKE_LOG}'"
run HOSTING_SITE_ID=instasupply-chosen -- --yes "$project"
check 'the name the operator chose is used' bash -c "[[ ${status} == 0 ]] && grep -qF 'hosting:sites:create instasupply-chosen' '${FAKE_LOG}'"
new_project
touch "${FAKE_STATE}/no_hosting_answer"
run -- --yes "$project"
check 'no answer about Hosting: creates no site, says so, carries on' bash -c \
  "[[ ${status} == 0 ]] && ! grep -qF hosting:sites:create '${FAKE_LOG}' && grep -qF 'Could not find out whether the project has a Hosting site' '${output}'"

# --- The functions env files and the secrets in them -------------------------------------------------------
echo
echo 'Functions settings and secrets'
new_project
mv "$env_file" "${env_file}.away"
run -- --yes "$project"
check 'no env file for the project: warns and uses the built-in secret list' bash -c \
  "[[ ${status} == 0 ]] && grep -qF 'does not exist' '${output}' && [[ -d '${FAKE_STATE}/secrets/OTP_PEPPER' ]]"
new_project
printf 'FUNCTIONS_REGION=us-central1\r\nMANAGED_SECRETS="OTP_PEPPER, STRIPE_SECRET_KEY"\r\n' >"$env_file"
run -- --yes "$project"
check 'the secret list comes from the env file (quotes, spaces, Windows line ends)' bash -c \
  "[[ ${status} == 0 && -d '${FAKE_STATE}/secrets/STRIPE_SECRET_KEY' && ! -d '${FAKE_STATE}/secrets/GOOGLE_MAPS_API_KEY' ]]"
check 'a region that differs from the env file is pointed out' said 'say FUNCTIONS_REGION=us-central1, but this run uses northamerica-northeast2'
new_project
printf 'FUNCTIONS_REGION=northamerica-northeast2 # Toronto\n' >"$env_file"
printf '  MANAGED_SECRETS=OTP_PEPPER,SHARED_SECRET\n' >"$shared_env_file"
run -- --yes "$project"
check 'the shared .env is read too, and a comment after a value is not part of it' bash -c \
  "[[ ${status} == 0 && -d '${FAKE_STATE}/secrets/SHARED_SECRET' ]] && ! grep -qF 'say FUNCTIONS_REGION' '${output}'"
new_project
printf 'MANAGED_SECRETS=OTP_PEPPER,not a name;x\n' >"$env_file"
run -- --yes "$project"
check 'something that is not a secret name stops the run' bash -c "[[ ${status} == 1 ]] && grep -qF 'is not a secret name' '${output}'"
check 'nothing was changed' changed_nothing
new_project
run -- --yes "$project"
mkdir -p "${FAKE_STATE}/unreadable_secrets"
touch "${FAKE_STATE}/unreadable_secrets/TWILIO_AUTH_TOKEN"
run -- --yes "$project"
check 'a secret whose newest version cannot be read is reported and not overwritten' bash -c \
  "[[ ${status} == 0 ]] && grep -qF 'the newest version cannot be read' '${output}' && [[ \"\$(find '${FAKE_STATE}/secrets/TWILIO_AUTH_TOKEN' -type f | wc -l | tr -d ' ')\" == 1 ]]"

# --- APIs and half-finished states ----------------------------------------------------------------------------
echo
echo 'APIs and half-made resources'
new_project
echo playintegrity.googleapis.com >"${FAKE_STATE}/refuse_apis"
run -- --yes "$project"
check 'an API nothing depends on is refused: reported, the setup goes on' bash -c \
  "[[ ${status} == 0 ]] && grep -qF 'Could not switch on the Maps, App Check provider or Extensions APIs' '${output}'"
new_project
echo cloudbilling.googleapis.com >"${FAKE_STATE}/refuse_apis"
run -- --yes "$project"
check 'an API a deploy depends on is refused: stops' stopped
check 'and the last words say what to do, not just what gcloud printed' said 'Fix the cause and run the script again'
new_project
with_apis_on
echo 2 >"${FAKE_STATE}/bucket_not_ready"
echo "{\"name\":\"projects/${project}/defaultBucket\",\"location\":\"northamerica-northeast2\",\"bucket\":{\"name\":\"projects/${project}/buckets/${project}.firebasestorage.app\"}}" >"${FAKE_STATE}/bucket"
touch "${FAKE_STATE}/accounts/${storage_agent}"
run -- --yes "$project"
check 'a bucket that is still being set up is waited for, not created twice' bash -c \
  "[[ ${status} == 0 ]] && ! grep -qF 'curl POST https://firebasestorage' '${FAKE_LOG}'"

new_project
with_apis_on
printf 'northamerica-northeast2\tFIRESTORE_NATIVE\tPOINT_IN_TIME_RECOVERY_ENABLED\tDELETE_PROTECTION_ENABLED\n' >"${FAKE_STATE}/database"
printf 'projects/%s/databases/(default)/backupSchedules/weekly\t8467200s\tMON\n' "$project" >"${FAKE_STATE}/backup_schedules"
run -- --yes "$project"
check 'a weekly backup schedule does not count as the daily one' called 'backups schedules create'
check 'a database that already has recovery and delete protection is not updated' did_not_call 'firestore databases update'
printf 'projects/%s/databases/(default)/backupSchedules/daily\t604800s\t\n' "$project" >"${FAKE_STATE}/backup_schedules"
run -- --yes "$project"
check 'a daily schedule with another retention is kept and pointed out' bash -c \
  "[[ ${status} == 0 ]] && ! grep -qF 'schedules create' '${FAKE_LOG}' && grep -qF 'would have set 14 days' '${output}'"

echo
if ((failed > 0)); then
  echo "${failed} check(s) failed, ${passed} passed. The files named above are deleted when this script ends."
  echo "To keep them for a look, remove the trap line near the top and run it again."
  exit 1
fi
echo "All ${passed} bootstrap checks passed."
