#!/usr/bin/env bash
# One-time setup of a Firebase / Google Cloud project for InstaSupply.
#
#   ./infra/bootstrap-project.sh [--yes] <project-id> [functions-region]
#
# Run it once per environment (staging, production) before the first CI deploy, signed in as a
# project Owner in both gcloud and the Firebase CLI. Run it again after adding a name to
# MANAGED_SECRETS or a new kind of function trigger: the CI account is not allowed to change who
# can access what, so those grants are made here. Running it again is always safe, because every
# step looks at what exists and only adds what is missing.
#
# What it sets up
#   - the Google APIs that a deploy and the apps use, so CI never has to switch one on
#   - the Firestore database and the default Storage bucket, both in FIRESTORE_LOCATION, with
#     point-in-time recovery, delete protection and daily backups
#   - the default Hosting site, which is the web address of the back office
#   - a Secret Manager entry for every name in MANAGED_SECRETS
#   - the access Firebase would otherwise ask an Owner for in the middle of a deploy
#   - the CI deploy account and, when the three GITHUB_ values are given, keyless sign-in for
#     GitHub Actions that only one environment of one repository can use
#   - Firestore rules, indexes and TTL policies, and Storage rules
#
# Options
#   --yes                      Ask nothing: accept the plan, and leave secrets that have no value
#                              yet for later.
#
# Settings (environment variables)
#   FIRESTORE_LOCATION         Where the database and the bucket live. Default
#                              northamerica-northeast2 (Toronto). It can never be changed later.
#   STORAGE_LOCATION           Only for a multi-region FIRESTORE_LOCATION such as nam5, a name
#                              Cloud Storage does not have. Default: FIRESTORE_LOCATION.
#   HOSTING_SITE_ID            The site in https://<site>.web.app, used only when the project has
#                              no Hosting site yet. Default: the project id. Also permanent.
#   GITHUB_REPO_ID             Set these three together to let one GitHub environment deploy to
#   GITHUB_OWNER_ID            this project. The ids are numbers:
#   GITHUB_DEPLOY_ENVIRONMENT    gh api repos/<owner>/<repo> --jq '"\(.id) \(.owner.id)"'
#                              The environment is "staging" or "production". Protect it in GitHub
#                              before you set these (the script prints how).
#
# Needs gcloud, node and curl on the PATH, and `npm ci` done in this checkout.
#
# After changing this file, run `bash infra/selftest.sh`. It runs the script against stand-ins for
# gcloud, curl and the Firebase CLI, from a new project, a second run and a dozen awkward states.
set -euo pipefail

# Toronto. Staging and production keep their functions, database and bucket here
# (docs/MARKETPLACE.md, decision D13). Emulators and local runs keep us-central1; they never go
# through this script.
readonly DEFAULT_LOCATION='northamerica-northeast2'
readonly BACKUP_RETENTION_DAYS=14
readonly IMAGE_RETENTION_DAYS=7
readonly DEPLOYER_NAME='instasupply-deployer'
readonly WIF_POOL='github'
readonly WIF_PROVIDER='github'
readonly GITHUB_ISSUER='https://token.actions.githubusercontent.com'
# What an earlier version of this script stored for a secret nobody had set. The functions sent it
# to Google as if it were an API key, so it is replaced wherever it is still found.
readonly LEGACY_PLACEHOLDER='unset'
# Secrets this script makes up itself. Every other secret comes from the operator.
readonly GENERATED_SECRETS=' OTP_PEPPER '
readonly FALLBACK_SECRETS='GOOGLE_MAPS_API_KEY,TWILIO_AUTH_TOKEN,OTP_PEPPER'

# ------------------------------------------------------------------------------------------------
# Output
# ------------------------------------------------------------------------------------------------

if [[ -t 1 ]]; then
  BLUE=$'\033[1;34m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[1;31m' RESET=$'\033[0m'
else
  BLUE='' GREEN='' YELLOW='' RED='' RESET=''
fi

step() { printf '\n%s▸ %s%s\n' "$BLUE" "$*" "$RESET"; }
info() { printf '  %s\n' "$*"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s! %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }

# False until the first command that changes the project, so an early stop can say that it left
# everything as it was.
CHANGES_STARTED=false
# True once the script has said why it is stopping. See finish().
EXPLAINED=false
die() {
  printf '\n%sStopped.%s %s\n' "$RED" "$RESET" "$*" >&2
  if [[ "$CHANGES_STARTED" == false ]]; then printf '  Nothing was changed.\n' >&2; fi
  EXPLAINED=true
  exit 1
}

# Things this run could not finish by itself, collected along the way and printed at the end.
FOLLOW_UPS=''
follow_up() { FOLLOW_UPS+="  - $*"$'\n'; }

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# ------------------------------------------------------------------------------------------------
# Arguments and settings
# ------------------------------------------------------------------------------------------------

ASSUME_YES=false
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    -y | --yes) ASSUME_YES=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "Unknown option \"${arg}\". Run with --help to see the usage." ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
if ((${#POSITIONAL[@]} < 1 || ${#POSITIONAL[@]} > 2)); then
  usage >&2
  exit 64
fi

PROJECT_ID="${POSITIONAL[0]}"
REGION="${POSITIONAL[1]:-$DEFAULT_LOCATION}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-$DEFAULT_LOCATION}"
STORAGE_LOCATION="${STORAGE_LOCATION:-$FIRESTORE_LOCATION}"
HOSTING_SITE_ID="${HOSTING_SITE_ID:-$PROJECT_ID}"
GITHUB_REPO_ID="${GITHUB_REPO_ID:-}"
GITHUB_OWNER_ID="${GITHUB_OWNER_ID:-}"
GITHUB_DEPLOY_ENVIRONMENT="${GITHUB_DEPLOY_ENVIRONMENT:-}"

# These values end up inside commands, a JSON body and an access rule, so nothing unexpected may
# be in them.
readonly project_id_pattern='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
readonly location_pattern='^[A-Za-z][A-Za-z0-9-]*$'
readonly site_id_pattern='^[a-z0-9][a-z0-9-]*[a-z0-9]$'
readonly number_pattern='^[0-9]+$'
readonly secret_name_pattern='^[A-Za-z_][A-Za-z0-9_]*$'

[[ "$PROJECT_ID" =~ $project_id_pattern ]] || die "\"${PROJECT_ID}\" is not a project id."
case "$PROJECT_ID" in
  demo-*) die "\"${PROJECT_ID}\" only exists in the emulators (demo-*). There is nothing to set up for it." ;;
esac
for location in "$REGION" "$FIRESTORE_LOCATION" "$STORAGE_LOCATION"; do
  [[ "$location" =~ $location_pattern ]] || die "\"${location}\" is not a region or location name."
done
[[ "$HOSTING_SITE_ID" =~ $site_id_pattern ]] || die "\"${HOSTING_SITE_ID}\" is not a Hosting site id."
# Firestore's multi-region names (nam5, nam7, eur3) mean nothing to Cloud Storage.
multi_region_pattern='^(nam|eur)[0-9]+$'
if [[ "$FIRESTORE_LOCATION" =~ $multi_region_pattern && "$STORAGE_LOCATION" == "$FIRESTORE_LOCATION" ]]; then
  die "Cloud Storage has no location called \"${FIRESTORE_LOCATION}\". Say where the bucket goes as well, for example STORAGE_LOCATION=US."
fi

CONFIGURE_GITHUB=false
if [[ -n "${GITHUB_REPO_ID}${GITHUB_OWNER_ID}${GITHUB_DEPLOY_ENVIRONMENT}" ]]; then
  [[ -n "$GITHUB_REPO_ID" && -n "$GITHUB_OWNER_ID" && -n "$GITHUB_DEPLOY_ENVIRONMENT" ]] ||
    die "Set GITHUB_REPO_ID, GITHUB_OWNER_ID and GITHUB_DEPLOY_ENVIRONMENT together, or none of them."
  [[ "$GITHUB_REPO_ID" =~ $number_pattern && "$GITHUB_OWNER_ID" =~ $number_pattern ]] ||
    die "GITHUB_REPO_ID and GITHUB_OWNER_ID are the numeric ids, not names. Find them with: gh api repos/<owner>/<repo> --jq '\"\\(.id) \\(.owner.id)\"'"
  case "$GITHUB_DEPLOY_ENVIRONMENT" in
    staging | production) ;;
    *) die "GITHUB_DEPLOY_ENVIRONMENT must be \"staging\" or \"production\", the two environments deploy.yml uses." ;;
  esac
  CONFIGURE_GITHUB=true
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly FIREBASE="${REPO_ROOT}/node_modules/.bin/firebase"
readonly FUNCTIONS_DIR="${REPO_ROOT}/firebase/functions"
readonly FUNCTIONS_ENV_FILE="${FUNCTIONS_DIR}/.env.${PROJECT_ID}"
# firebase.json is read from the current directory.
cd "$REPO_ROOT"

# ------------------------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------------------------

HTTP_BODY="$(mktemp)"
readonly HTTP_BODY
HTTP_STATUS=''

# Runs when the script ends, however it ends. A command that fails under `set -e` ends it on the
# spot, and without this the last thing on screen would be that command's own error and nothing
# about what to do next.
finish() {
  local code=$?
  rm -f "$HTTP_BODY"
  if [[ "$code" != 0 && "$EXPLAINED" == false ]]; then
    printf '\n%sStopped.%s The command above failed (exit code %s).\n' "$RED" "$RESET" "$code" >&2
    if [[ "$CHANGES_STARTED" == true ]]; then
      printf '  What was set up before it stays as it is. Fix the cause and run the script again: steps that\n  are done are not done twice.\n' >&2
    else
      printf '  Nothing was changed.\n' >&2
    fi
  fi
}
trap finish EXIT

# eventually <tries> <seconds> <command...>
# Runs a command until it works. A service account created a moment ago, or an API switched on a
# moment ago, is not known everywhere at once, so the first try of a step that depends on one can
# fail for no lasting reason. Output is kept quiet; the last failure is shown.
eventually() {
  local tries="$1" pause="$2" attempt=1 output
  shift 2
  while true; do
    if output="$("$@" 2>&1)"; then return 0; fi
    if ((attempt >= tries)); then
      printf '%s\n' "$output" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep "$pause"
  done
}

# google_api <method> <url> [json-body]
# Calls a Google REST API as the gcloud account, for the few things gcloud has no command for. The
# status code lands in HTTP_STATUS and the answer in the file HTTP_BODY.
#   - x-goog-user-project bills and authorises the call against this project. Without it a user's
#     token counts against gcloud's own project, where these APIs are off.
#   - The token reaches curl on stdin. On the command line, every user of the machine could read
#     it in the process list.
google_api() {
  local method="$1" url="$2" body="${3:-}" token
  HTTP_STATUS=''
  : >"$HTTP_BODY"
  token="$(gcloud auth print-access-token)" || return 1
  HTTP_STATUS="$(
    printf 'header = "Authorization: Bearer %s"\n' "$token" |
      curl --silent --show-error --max-time 120 --config - \
        --request "$method" \
        --header "x-goog-user-project: ${PROJECT_ID}" \
        --header 'Content-Type: application/json' \
        ${body:+--data "$body"} \
        --output "$HTTP_BODY" --write-out '%{http_code}' "$url"
  )" || return 1
}

die_with_response() {
  printf '\n%sStopped.%s %s (HTTP %s):\n' "$RED" "$RESET" "$1" "$HTTP_STATUS" >&2
  head -c 2000 "$HTTP_BODY" >&2 2>/dev/null || true
  printf '\n' >&2
  EXPLAINED=true
  exit 1
}

# json_query <expression>: reads a JSON document on stdin and prints the value of a JavaScript
# expression over it, with the document called `d`. Prints nothing for a missing value.
#   json_query 'd.bucket?.name' <"$HTTP_BODY"
json_query() {
  node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => {
      const value = new Function("d", "return (" + process.argv[1] + ");")(JSON.parse(text));
      if (value != null) console.log(String(value));
    });
  ' "$1" 2>/dev/null || true
}

# env_file_value <KEY>: the value the deployed functions get for KEY, or nothing. The Firebase CLI
# reads .env first and then .env.<project-id>, and the later file wins. So does this.
env_file_value() {
  local key="$1" file line value=''
  for file in "${FUNCTIONS_DIR}/.env" "$FUNCTIONS_ENV_FILE"; do
    [[ -f "$file" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line#"${line%%[![:space:]]*}"}"
      case "$line" in
        "${key}="*) value="${line#*=}" ;;
      esac
    done <"$file"
  done
  value="${value%$'\r'}"
  value="${value%%[[:space:]]#*}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

# grant_on_project <member> <role>...
# --condition=None is not decoration. The Firebase CLI only counts a grant that has no condition,
# and gcloud refuses to guess when the policy already holds conditional grants.
grant_on_project() {
  local member="$1" role
  shift
  for role in "$@"; do
    eventually 12 10 gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="$member" --role="$role" --condition=None || return 1
    ok "${role} → ${member#*:}"
  done
}

# A database or a bucket in the wrong place cannot be repaired, only replaced together with the
# project. So both are looked at twice: once before anything is changed, to stop early, and once
# in their own step, where a missing one is created.

DB_EXISTS=false
DB_LOCATION=''
DB_TYPE=''
DB_RECOVERY=''
DB_PROTECTION=''

# Fills in the DB_ variables. Fails when Firestore gives no answer, which on a project whose APIs
# are still off simply means there is no database yet.
read_database() {
  local names details
  names="$(gcloud firestore databases list --format='value(name)' 2>/dev/null)" || return 1
  DB_EXISTS=false
  case $'\n'"${names}"$'\n' in
    *'/databases/(default)'$'\n'*) ;;
    *) return 0 ;;
  esac
  details="$(gcloud firestore databases describe --database='(default)' \
    --format='value(locationId,type,pointInTimeRecoveryEnablement,deleteProtectionState)' 2>/dev/null)" || return 1
  IFS=$'\t' read -r DB_LOCATION DB_TYPE DB_RECOVERY DB_PROTECTION <<<"$details"
  DB_EXISTS=true
}

require_database_fits() {
  [[ "$DB_EXISTS" == true ]] || return 0
  if [[ "$DB_TYPE" != 'FIRESTORE_NATIVE' ]]; then
    die "The database of ${PROJECT_ID} is in ${DB_TYPE:-an unknown} mode. InstaSupply needs Firestore in Native mode, and the mode of a database with data cannot be changed. Use a new project."
  fi
  if [[ "$(lower "$DB_LOCATION")" != "$(lower "$FIRESTORE_LOCATION")" ]]; then
    die "The Firestore database of ${PROJECT_ID} is in \"${DB_LOCATION}\", but this run asks for \"${FIRESTORE_LOCATION}\".
  A Firestore location can never be changed. To get a database in ${FIRESTORE_LOCATION}, use a new project and run
  this script on it before any deploy. (Deleting the database and running the script again also works, but it
  destroys everything stored in it.)
  If \"${DB_LOCATION}\" is where this project is meant to be, run again with FIRESTORE_LOCATION=${DB_LOCATION}."
  fi
}

# gcloud cannot create or even recognise the bucket Firebase treats as the default one, so this
# talks to the Cloud Storage for Firebase API. That is the API the Firebase CLI asks during a
# deploy, and a deploy that includes Storage rules stops before publishing anything when the
# answer is "no bucket".
readonly BUCKET_API="https://firebasestorage.googleapis.com/v1alpha/projects/${PROJECT_ID}/defaultBucket"
BUCKET_NAME=''
BUCKET_LOCATION=''

# Returns 0 and fills in BUCKET_NAME and BUCKET_LOCATION when the project has a default bucket,
# 1 when it has none, and 2 when the API gives neither answer (off, or the bucket is half made).
read_default_bucket() {
  google_api GET "$BUCKET_API" || return 2
  case "$HTTP_STATUS" in
    200)
      BUCKET_NAME="$(json_query 'd.bucket?.name' <"$HTTP_BODY")"
      BUCKET_NAME="${BUCKET_NAME##*/}"
      BUCKET_LOCATION="$(json_query 'd.location' <"$HTTP_BODY")"
      [[ -n "$BUCKET_NAME" ]] || return 2
      ;;
    404) return 1 ;;
    *) return 2 ;;
  esac
}

require_bucket_fits() {
  if [[ -z "$BUCKET_LOCATION" ]]; then
    BUCKET_LOCATION="$(gcloud storage buckets describe "gs://${BUCKET_NAME}" --format='value(location)' 2>/dev/null || true)"
  fi
  if [[ "$(lower "$BUCKET_LOCATION")" != "$(lower "$STORAGE_LOCATION")" ]]; then
    die "The default bucket ${BUCKET_NAME} is in \"${BUCKET_LOCATION:-an unknown location}\", but this run asks for \"${STORAGE_LOCATION}\".
  A bucket can never be moved, and a project has one default bucket. To get it in ${STORAGE_LOCATION}, use a new
  project and run this script on it before anyone opens Storage in the Firebase console.
  If \"${BUCKET_LOCATION}\" is where this project is meant to be, run again with STORAGE_LOCATION=${BUCKET_LOCATION}."
  fi
}

# ------------------------------------------------------------------------------------------------
# Checks before anything is changed
# ------------------------------------------------------------------------------------------------

for tool in gcloud node curl; do
  command -v "$tool" >/dev/null 2>&1 || die "\"${tool}\" is not installed or not on the PATH."
done
[[ -x "$FIREBASE" ]] || die "The Firebase CLI is missing from this checkout. Run \"npm ci\" in ${REPO_ROOT} first."

# Backup schedules are the newest gcloud feature used below. Asking for their help page needs no
# sign-in and no network, and tells an outdated gcloud apart before it fails halfway through.
gcloud firestore backups schedules list --help >/dev/null 2>&1 ||
  die 'This gcloud is too old for the commands used here. Update it (gcloud components update) and run again.'

# Every gcloud command below acts on this project, whatever the operator's default project is, and
# none of them stops to ask a question.
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
[[ -n "$ACCOUNT" ]] || die "gcloud is not signed in. Run: gcloud auth login"
gcloud auth print-access-token >/dev/null 2>&1 ||
  die "The gcloud sign-in of ${ACCOUNT} has expired. Run: gcloud auth login"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
[[ "$PROJECT_NUMBER" =~ $number_pattern ]] ||
  die "${ACCOUNT} cannot see a project called \"${PROJECT_ID}\". Create it in the Firebase console first (docs/DEPLOYMENT.md, step 1) and check the id."

# Functions need the Blaze plan, and so does creating the default bucket. Not being able to read
# the billing state is no reason to stop: the steps that need billing say so themselves.
billing="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
if [[ "$(lower "$billing")" == 'false' ]]; then
  die "${PROJECT_ID} is not on the Blaze plan. Upgrade it first: https://console.firebase.google.com/project/${PROJECT_ID}/usage/details"
fi

# The Firebase CLI keeps its own sign-in, separate from gcloud's. Finding out now beats finding out
# at the last step. The same call fails for a Google Cloud project that Firebase was never added to.
if ! firebase_check="$("$FIREBASE" apps:list --project "$PROJECT_ID" --non-interactive 2>&1)"; then
  printf '%s\n' "$firebase_check" >&2
  die "The Firebase CLI cannot open ${PROJECT_ID}. Sign in with \"npx firebase login\" as ${ACCOUNT}, and make sure Firebase has been added to the project."
fi

if read_database; then require_database_fits; fi
if read_default_bucket; then require_bucket_fits; fi

# The functions take the names of their secrets from MANAGED_SECRETS in their env files, so those
# files are the one list of secrets. A second, hand-kept list here would drift.
SECRETS_SOURCE='MANAGED_SECRETS in the functions env files'
SECRET_LIST="$(env_file_value MANAGED_SECRETS)"
if [[ -z "$SECRET_LIST" ]]; then
  SECRET_LIST="$FALLBACK_SECRETS"
  SECRETS_SOURCE='the built-in list, because the functions env files set no MANAGED_SECRETS'
fi
IFS=', ' read -r -a SECRETS <<<"$SECRET_LIST"
for secret in "${SECRETS[@]}"; do
  [[ "$secret" =~ $secret_name_pattern ]] || die "\"${secret}\" in MANAGED_SECRETS is not a secret name."
done
ENV_FILE_REGION="$(env_file_value FUNCTIONS_REGION)"

# The accounts the rest of the script hands access to. Their addresses follow fixed patterns.
#   - 2nd-gen functions run, build and receive events as the Compute Engine default account unless
#     the code names another one. If the functions ever set `serviceAccount`, change RUNTIME_SA.
#   - The Storage and Pub/Sub service agents are Google's own accounts for those products.
readonly COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
readonly RUNTIME_SA="$COMPUTE_SA"
readonly APP_ENGINE_SA="${PROJECT_ID}@appspot.gserviceaccount.com"
readonly STORAGE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-firebasestorage.iam.gserviceaccount.com"
readonly PUBSUB_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
readonly DEPLOYER_SA="${DEPLOYER_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
readonly WIF_POOL_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}"

printf '\nInstaSupply project setup\n\n'
printf '  %-20s %s (number %s)\n' 'Project' "$PROJECT_ID" "$PROJECT_NUMBER"
printf '  %-20s %s\n' 'Signed in as' "$ACCOUNT"
printf '  %-20s %s\n' 'Functions region' "$REGION"
printf '  %-20s %s   (can never be changed)\n' 'Firestore location' "$FIRESTORE_LOCATION"
printf '  %-20s %s   (can never be changed)\n' 'Storage bucket' "$STORAGE_LOCATION"
printf '  %-20s https://%s.web.app   (if the project has no site yet; can never be changed)\n' \
  'Web address' "$HOSTING_SITE_ID"
printf '  %-20s %s\n' 'Secrets' "${SECRETS[*]}"
printf '  %-20s from %s\n' '' "$SECRETS_SOURCE"
if [[ "$CONFIGURE_GITHUB" == true ]]; then
  printf '  %-20s environment "%s" of repository %s (owner %s)\n' 'GitHub Actions' \
    "$GITHUB_DEPLOY_ENVIRONMENT" "$GITHUB_REPO_ID" "$GITHUB_OWNER_ID"
else
  printf '  %-20s not set up in this run (no GITHUB_ values given)\n' 'GitHub Actions'
fi
printf '\n'

if [[ "$REGION" != "$DEFAULT_LOCATION" || "$FIRESTORE_LOCATION" != "$DEFAULT_LOCATION" || "$STORAGE_LOCATION" != "$DEFAULT_LOCATION" ]]; then
  warn "Staging and production keep the functions, the database and the bucket in ${DEFAULT_LOCATION} (Toronto). This run does not."
fi
if [[ ! -f "$FUNCTIONS_ENV_FILE" ]]; then
  warn "firebase/functions/.env.${PROJECT_ID} does not exist. Without it the functions deploy with built-in defaults: us-central1 and no secrets."
  follow_up "Create firebase/functions/.env.${PROJECT_ID} (copy .env.example) with FUNCTIONS_REGION=${REGION} before the first deploy."
elif [[ "$ENV_FILE_REGION" != "$REGION" ]]; then
  warn "The functions env files say FUNCTIONS_REGION=${ENV_FILE_REGION:-<not set, so us-central1>}, but this run uses ${REGION}. The functions go where the files say."
  follow_up "Set FUNCTIONS_REGION=${REGION} in firebase/functions/.env.${PROJECT_ID}, and the same region in the client builds, before the first deploy."
fi

info 'The script will switch on APIs, create what is missing from the list above, give Google'
info 'service accounts and the CI deploy account the access a deploy needs, and publish the'
info 'Firestore and Storage rules. It never deletes data.'
if [[ "$ASSUME_YES" != true ]]; then
  [[ -t 0 ]] || die "Not running in a terminal, so nobody can confirm. Check the plan above and run again with --yes."
  printf '\n  Continue? [y/N] '
  IFS= read -r answer || answer=''
  case "$answer" in
    y | Y | yes | YES) ;;
    *) die 'Not confirmed.' ;;
  esac
fi
CHANGES_STARTED=true

# ------------------------------------------------------------------------------------------------
step "Switching on Google APIs"
# ------------------------------------------------------------------------------------------------
# The CI account may not switch APIs on, and the Firebase CLI tries to switch on any API it needs
# and finds off. So everything a deploy touches must be on before the first CI run. The one that is
# easy to miss is Cloud Billing: every functions deploy asks it whether the project can pay. With
# that API off, the deploy tries to switch it on and stops right there.
#
# One request takes at most 20 services, hence the groups.
info 'Deploy tooling'
gcloud services enable \
  serviceusage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com cloudbilling.googleapis.com \
  firebase.googleapis.com firebaserules.googleapis.com
info 'Backend'
gcloud services enable \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com firestore.googleapis.com \
  storage.googleapis.com firebasestorage.googleapis.com firebasehosting.googleapis.com \
  fcm.googleapis.com firebaseappcheck.googleapis.com
# Nothing below depends on these, so a refusal (for example terms that were never accepted) is
# reported and does not stop the setup. Routes and Geocoding serve the Maps key. reCAPTCHA
# Enterprise and Play Integrity are what App Check verifies web and Android apps with. A functions
# deploy lists the project's extensions and only complains when it cannot.
info 'Maps, App Check providers, Extensions'
if ! gcloud services enable routes.googleapis.com geocoding-backend.googleapis.com \
  recaptchaenterprise.googleapis.com playintegrity.googleapis.com firebaseextensions.googleapis.com; then
  warn 'Could not switch on the Maps, App Check provider or Extensions APIs (see the error above).'
  follow_up 'Switch on these APIs in the Cloud console: Routes, Geocoding, reCAPTCHA Enterprise, Play Integrity, Firebase Extensions.'
fi
ok 'APIs are on (Firebase Authentication follows in the next step)'

# Everything from here on changes who can do what, which takes an Owner. Asking now avoids a
# project that is left half set up.
if google_api POST "https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:testIamPermissions" \
  '{"permissions":["resourcemanager.projects.setIamPolicy"]}' && [[ "$HTTP_STATUS" == 200 ]]; then
  if [[ "$(json_query 'd.permissions?.includes("resourcemanager.projects.setIamPolicy")' <"$HTTP_BODY")" == true ]]; then
    ok "${ACCOUNT} may change access on ${PROJECT_ID}"
  else
    die "${ACCOUNT} may not change access on ${PROJECT_ID}. This script has to be run by a project Owner."
  fi
else
  warn "Could not check that ${ACCOUNT} is an Owner of ${PROJECT_ID}. Carrying on; a step that needs it will say so."
fi

# ------------------------------------------------------------------------------------------------
step "Web address (default Hosting site)"
# ------------------------------------------------------------------------------------------------
# Projects created since 15 October 2026 start without a Hosting site. The first site a project
# gets is its default site for good: it cannot be renamed or deleted. Two things follow.
#   - CI cannot create it, because a deploy that finds no site wants to ask for a name. So it is
#     created here.
#   - Switching on Firebase Authentication creates it as a side effect, under whatever name is
#     free. So Authentication is switched on only after the site has the name we chose.

# Prints the id of the default site, or nothing when the project has none. Fails when Firebase
# gives no clear answer, so "could not find out" is never mistaken for "there is none".
default_hosting_site() {
  local site
  google_api GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}" || return 1
  [[ "$HTTP_STATUS" == 200 ]] || return 1
  site="$(json_query 'd.resources?.hostingSite' <"$HTTP_BODY")"
  if [[ -z "$site" ]]; then
    google_api GET "https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites?pageSize=100" ||
      return 1
    [[ "$HTTP_STATUS" == 200 ]] || return 1
    site="$(json_query 'd.sites?.find((s) => s.type === "DEFAULT_SITE")?.name.split("/").pop()' <"$HTTP_BODY")"
  fi
  printf '%s' "$site"
}

if ! HOSTING_SITE="$(default_hosting_site)"; then
  HOSTING_SITE=''
  warn 'Could not find out whether the project has a Hosting site, so none was created here.'
  follow_up "Look up the web address under Hosting in the Firebase console (Firebase makes a site by itself when Authentication is switched on) and use it for TRACKING_BASE_URL in firebase/functions/.env.${PROJECT_ID}."
elif [[ -n "$HOSTING_SITE" ]]; then
  ok "The default site exists: https://${HOSTING_SITE}.web.app"
else
  info "Creating the default site https://${HOSTING_SITE_ID}.web.app"
  "$FIREBASE" hosting:sites:create "$HOSTING_SITE_ID" --project "$PROJECT_ID" --non-interactive ||
    die "Could not create the Hosting site \"${HOSTING_SITE_ID}\" (see the error above). Site names are shared by all Firebase projects. If this one is taken, choose another with HOSTING_SITE_ID=<name> and run again."
  HOSTING_SITE="$HOSTING_SITE_ID"
  ok "Created https://${HOSTING_SITE}.web.app"
fi
if [[ -n "$HOSTING_SITE" && "$HOSTING_SITE" != "$PROJECT_ID" ]]; then
  follow_up "The web address is https://${HOSTING_SITE}.web.app, not https://${PROJECT_ID}.web.app. Use it (or your own domain) for TRACKING_BASE_URL in firebase/functions/.env.${PROJECT_ID}."
fi

info 'Switching on Firebase Authentication'
gcloud services enable identitytoolkit.googleapis.com

# ------------------------------------------------------------------------------------------------
step "Firestore database in ${FIRESTORE_LOCATION}"
# ------------------------------------------------------------------------------------------------
# The database is created here, before any `firebase deploy`, on purpose. A deploy to a project
# without a database creates one by itself, in the United States (nam5), and a database can never
# be moved.
eventually 6 10 gcloud firestore databases list --format='value(name)' ||
  die "The Firestore API does not answer for ${PROJECT_ID} (see the error above)."
read_database || die "Could not read the Firestore database of ${PROJECT_ID}."
require_database_fits

if [[ "$DB_EXISTS" == true ]]; then
  ok "The database exists, in ${DB_LOCATION}"
  if [[ "$DB_RECOVERY" != 'POINT_IN_TIME_RECOVERY_ENABLED' || "$DB_PROTECTION" != 'DELETE_PROTECTION_ENABLED' ]]; then
    info 'Turning on point-in-time recovery and delete protection'
    gcloud firestore databases update --database='(default)' --enable-pitr --delete-protection >/dev/null
  fi
else
  info "Creating the database in ${FIRESTORE_LOCATION}"
  gcloud firestore databases create --database='(default)' --location="$FIRESTORE_LOCATION" \
    --type=firestore-native --enable-pitr --delete-protection >/dev/null
fi
ok 'Point-in-time recovery (7 days) and delete protection are on'

# Backups are kept in the same location as the database, so they stay in the same country too.
# A database has room for one daily and one weekly schedule. Only a weekly one names a day.
has_daily_schedule=false
daily_retention=''
schedules="$(gcloud firestore backups schedules list --database='(default)' \
  --format='value(name,retention,weeklyRecurrence.day)')"
while IFS=$'\t' read -r schedule_name schedule_retention schedule_day; do
  if [[ -n "$schedule_name" && -z "$schedule_day" ]]; then
    has_daily_schedule=true
    daily_retention="$schedule_retention"
  fi
done <<<"$schedules"
if [[ "$has_daily_schedule" == true ]]; then
  ok "A daily backup schedule exists (each backup is kept for ${daily_retention:-an unknown time})"
  # gcloud reports the time in seconds.
  if [[ -n "$daily_retention" && "$daily_retention" != "$((BACKUP_RETENTION_DAYS * 86400))s" ]]; then
    info "This script would have set ${BACKUP_RETENTION_DAYS} days. The existing schedule is left as it is."
  fi
else
  info "Scheduling a backup every day, each kept for ${BACKUP_RETENTION_DAYS} days"
  gcloud firestore backups schedules create --database='(default)' \
    --recurrence=daily --retention="${BACKUP_RETENTION_DAYS}d" >/dev/null
  ok 'Daily backups are scheduled'
fi

# ------------------------------------------------------------------------------------------------
step "Default Storage bucket in ${STORAGE_LOCATION}"
# ------------------------------------------------------------------------------------------------
# The API needs a moment after it is switched on, and after it has made a bucket, before it gives a
# straight answer. Returns 0 when there is a bucket and 1 when there is none.
find_default_bucket() {
  local attempt status
  for attempt in 1 2 3 4 5 6; do
    if read_default_bucket; then return 0; else status=$?; fi
    if [[ "$status" == 1 ]]; then return 1; fi
    if ((attempt < 6)); then sleep 10; fi
  done
  die_with_response 'The Cloud Storage for Firebase API gave no usable answer about the default bucket'
}

if find_default_bucket; then
  ok "The default bucket exists: ${BUCKET_NAME}"
else
  info "Creating the default bucket in ${STORAGE_LOCATION}"
  google_api POST "$BUCKET_API" "{\"location\":\"${STORAGE_LOCATION}\"}" ||
    die 'Could not reach firebasestorage.googleapis.com.'
  [[ "$HTTP_STATUS" == 200 ]] || die_with_response "Creating the default bucket in ${STORAGE_LOCATION} failed"
  find_default_bucket || die 'The bucket was created but is not listed yet. Run the script again in a minute.'
  ok "Created ${BUCKET_NAME}"
fi
require_bucket_fits
ok "The bucket is in ${BUCKET_LOCATION}"

# ------------------------------------------------------------------------------------------------
step "Access that a deploy would otherwise ask an Owner for"
# ------------------------------------------------------------------------------------------------
# The CI account can deploy code but cannot change who has access to what. If it could, it could
# make itself Owner. The Firebase CLI checks a handful of grants during a deploy and tries to add
# the missing ones, which fails for an account like that. All of them are made here instead, so
# the CLI finds them in place and moves on.

# The functions' own account appears shortly after the Cloud Run and Cloud Functions APIs are
# switched on. Without it there is nobody to grant anything to.
info "Waiting for the functions' service account ${COMPUTE_SA}"
if ! eventually 6 10 gcloud iam service-accounts describe "$COMPUTE_SA" 2>/dev/null; then
  info 'It did not appear. Switching on the Compute Engine API, which creates it.'
  info '(That API also adds a "default" network to the project. InstaSupply does not use it.)'
  gcloud services enable compute.googleapis.com
  eventually 12 10 gcloud iam service-accounts describe "$COMPUTE_SA" ||
    die "The service account ${COMPUTE_SA} does not exist. If it was deleted, restore it (gcloud iam service-accounts undelete) or give the functions a service account of their own, then run this script again."
fi

# Google creates the accounts of these services only when asked. The Firebase CLI asks on every
# deploy; asking here means the grants below have someone to go to. A refusal is not fatal: if an
# account is really missing, the grant for it fails and says so.
for service in pubsub.googleapis.com eventarc.googleapis.com firebasestorage.googleapis.com; do
  google_api POST "https://serviceusage.googleapis.com/v1beta1/projects/${PROJECT_NUMBER}/services/${service}:generateServiceIdentity" '{}' ||
    true
done

# Storage rules that look things up in Firestore.
# firebase/storage.rules calls firestore.get() to check who a delivery belongs to. Storage may only
# read Firestore if its service agent holds the "Firebase Rules Firestore Service Agent" role. The
# Firebase console and CLI offer that role in a prompt, and the CLI skips the prompt whenever it
# runs with --non-interactive, which is every deploy we do. Without the role the lookup fails, the
# rule denies, and drivers cannot upload a proof photo. The emulator never checks this, so tests
# pass either way. The service agent is created together with the default bucket, which is why
# this comes after it.
grant_on_project "serviceAccount:${STORAGE_AGENT}" roles/firebaserules.firestoreServiceAgent ||
  die "Could not give the Storage service agent access to Firestore. Proof-photo uploads stay blocked until this works. The agent is created with the default bucket; run the script again in a few minutes."

# What the Firebase CLI adds on the first deploy of a function with an event trigger: Pub/Sub must
# be able to sign the requests it delivers, and the account behind the triggers must be allowed to
# receive events and call the functions.
grant_on_project "serviceAccount:${PUBSUB_AGENT}" roles/iam.serviceAccountTokenCreator ||
  die "Could not set up the Pub/Sub service agent (see the error above). Run the script again in a few minutes."
grant_on_project "serviceAccount:${COMPUTE_SA}" roles/run.invoker roles/eventarc.eventReceiver ||
  die "Could not set up ${COMPUTE_SA} (see the error above)."
# A new kind of trigger can need one more grant of this sort (Storage triggers do). The CLI prints
# the gcloud command when a deploy stops on one; add it here and run the script again.

# What the functions need to build and to run.
# The Compute Engine default account used to get the Editor role automatically. Organisations
# created since May 2024 no longer hand that out, and then the first build fails and, once that is
# fixed, every Firestore call does. Naming the roles makes both kinds of project behave the same.
# Keep this list in step with what the functions use: Firestore, Firebase Auth, FCM, and reading
# uploads from the default bucket.
grant_on_project "serviceAccount:${RUNTIME_SA}" roles/cloudbuild.builds.builder roles/datastore.user \
  roles/firebaseauth.admin roles/firebasecloudmessaging.admin ||
  die "Could not set up ${RUNTIME_SA} (see the error above)."
eventually 6 10 gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/storage.objectViewer --condition=None ||
  die "Could not let ${RUNTIME_SA} read ${BUCKET_NAME} (see the error above)."
ok "roles/storage.objectViewer on ${BUCKET_NAME} → ${RUNTIME_SA}"

# ------------------------------------------------------------------------------------------------
step "Secrets"
# ------------------------------------------------------------------------------------------------
# A deploy refuses a secret that does not exist or has no enabled version, so every name needs
# some value from day one. For a secret nobody has a value for yet, that value is a single newline.
# The functions trim what they read (config/runtime.ts), which turns it into an empty string, and
# an empty string already means "not configured": geocoding falls back to OpenStreetMap, SMS is
# not sent. A word such as "unset" must never be stored. It is not empty, so it gets used as if it
# were the real key.

# Prints: missing | empty | blank | placeholder | set | unreadable
secret_state() {
  local name="$1" versions value
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    echo missing
    return 0
  fi
  versions="$(gcloud secrets versions list "$name" --limit=1 --format='value(name)')" || return 1
  if [[ -z "$versions" ]]; then
    echo empty
    return 0
  fi
  # A newest version that is disabled or destroyed cannot be read. That is not "empty": adding a
  # version on top could bury a real key, so it is reported and left alone.
  if ! value="$(gcloud secrets versions access latest --secret="$name" 2>/dev/null)"; then
    echo unreadable
  elif [[ -z "${value//[[:space:]]/}" ]]; then
    echo blank
  elif [[ "$value" == "$LEGACY_PLACEHOLDER" ]]; then
    echo placeholder
  else
    echo set
  fi
}

# The value never appears on a command line: printf is part of the shell, not a separate program.
add_secret_version() { printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null; }

ask_for_secret() {
  local value=''
  printf '  Value for %s (press Enter to leave it for later): ' "$1" >&2
  IFS= read -r -s value || true
  printf '\n' >&2
  printf '%s' "$value"
}

UNSET_SECRETS=''
eventually 6 10 gcloud secrets list --limit=1 --format='value(name)' ||
  die "Secret Manager does not answer for ${PROJECT_ID} (see the error above)."

for secret in "${SECRETS[@]}"; do
  state="$(secret_state "$secret")"
  if [[ "$state" == missing ]]; then
    gcloud secrets create "$secret" --replication-policy=automatic >/dev/null
    state=empty
  fi

  case "$state" in
    set) ok "${secret} has a value" ;;
    unreadable)
      warn "${secret}: the newest version cannot be read (disabled or destroyed?). A deploy needs it enabled. Left as it is."
      follow_up "Check ${secret}: enable its newest version, or store a new value with: npx firebase functions:secrets:set ${secret} --project ${PROJECT_ID}"
      ;;
    *)
      # empty, blank or placeholder: there is no real value yet.
      value=''
      if [[ "$GENERATED_SECRETS" == *" ${secret} "* ]]; then
        value="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
        add_secret_version "$secret" "$value"
        ok "${secret} generated"
      else
        if [[ "$state" != blank && "$ASSUME_YES" != true && -t 0 ]]; then
          value="$(ask_for_secret "$secret")"
        fi
        if [[ -n "$value" ]]; then
          add_secret_version "$secret" "$value"
          ok "${secret} stored"
        else
          if [[ "$state" != blank ]]; then add_secret_version "$secret" $'\n'; fi
          if [[ "$state" == placeholder ]]; then
            info "${secret} held the old placeholder \"${LEGACY_PLACEHOLDER}\", which the functions used as a real key. Replaced."
          fi
          warn "${secret} has no value yet"
          UNSET_SECRETS+=" ${secret}"
        fi
      fi
      value=''
      ;;
  esac

  # The Firebase CLI checks this grant on each secret, one by one, and tries to add it when it is
  # missing. A project-wide grant would not satisfy it and would open every other secret too.
  eventually 6 10 gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor --condition=None ||
    die "Could not let the functions read ${secret} (see the error above)."
done
ok "The functions (${RUNTIME_SA}) can read: ${SECRETS[*]}"

# ------------------------------------------------------------------------------------------------
step "Deploy account for CI (${DEPLOYER_SA})"
# ------------------------------------------------------------------------------------------------
if gcloud iam service-accounts describe "$DEPLOYER_SA" >/dev/null 2>&1; then
  ok 'The account exists'
else
  info 'Creating the account'
  gcloud iam service-accounts create "$DEPLOYER_NAME" --display-name='InstaSupply CI deployer' >/dev/null
fi

# Enough to publish functions, rules, indexes and the website, and nothing that changes access:
#   firebase.admin               rules, indexes, Hosting, Storage rules, reading the project's policy
#   cloudfunctions.admin         create and update functions
#   run.admin                    2nd-gen functions are Cloud Run services; makes callables reachable
#   cloudscheduler.admin         scheduled functions
#   artifactregistry.admin       the cleanup policy for old function images
#   secretmanager.viewer         see that a secret exists and who may read it; not its value
#   serviceUsageConsumer         make API calls that count against this project
# An account that deploys code controls what that code does with the data, whatever its roles
# are. The real guard is who may sign in as this account; see the GitHub step.
grant_on_project "serviceAccount:${DEPLOYER_SA}" roles/firebase.admin roles/cloudfunctions.admin \
  roles/run.admin roles/cloudscheduler.admin roles/artifactregistry.admin roles/secretmanager.viewer \
  roles/serviceusage.serviceUsageConsumer ||
  die "Could not set up ${DEPLOYER_SA} (see the error above)."

# Deploying a function means attaching a service account to it, and that takes permission to "act
# as" that account. It is given on the functions' account only. An earlier version of this script
# gave it on the whole project, which let CI borrow any service account in it, so that grant is
# taken away again.
eventually 6 10 gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOYER_SA}" --role=roles/iam.serviceAccountUser --condition=None ||
  die "Could not let ${DEPLOYER_SA} deploy functions that run as ${RUNTIME_SA} (see the error above)."
ok "roles/iam.serviceAccountUser on ${RUNTIME_SA} → ${DEPLOYER_SA}"

# Projects that once had App Engine still have its service account, and the Firebase CLI refuses
# to start a functions deploy unless the caller may act as it. New projects have no such account.
if gcloud iam service-accounts describe "$APP_ENGINE_SA" >/dev/null 2>&1; then
  eventually 6 10 gcloud iam service-accounts add-iam-policy-binding "$APP_ENGINE_SA" \
    --member="serviceAccount:${DEPLOYER_SA}" --role=roles/iam.serviceAccountUser --condition=None ||
    die "Could not let ${DEPLOYER_SA} act as ${APP_ENGINE_SA} (see the error above)."
  ok "roles/iam.serviceAccountUser on ${APP_ENGINE_SA} → ${DEPLOYER_SA}"
fi

project_wide_act_as="$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
  --filter='bindings.role:roles/iam.serviceAccountUser' --format='value(bindings.role,bindings.members)')"
case $'\n'"${project_wide_act_as}"$'\n' in
  *$'\n'"roles/iam.serviceAccountUser"$'\t'"serviceAccount:${DEPLOYER_SA}"$'\n'*)
    info 'Taking away the old project-wide roles/iam.serviceAccountUser grant'
    gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOYER_SA}" \
      --role=roles/iam.serviceAccountUser --all >/dev/null
    ok 'Removed'
    ;;
esac

# ------------------------------------------------------------------------------------------------
step "Sign-in for GitHub Actions without keys"
# ------------------------------------------------------------------------------------------------
# GitHub hands a signed token to any job of any workflow in a repository that asks for one, on any
# branch and in any pull request from a branch of the repository. Trusting "this repository"
# therefore trusts anyone who can push a branch, and the reviewers on the production environment
# would guard nothing. The rule below accepts a token only when it names this repository, this
# GitHub environment and the git ref that environment deploys from. A job gets the environment's
# name into its token only by running in that environment, which GitHub allows after the
# environment's own protection rules have passed. That is what makes the reviewers a real gate.
#
# The repository and its owner are matched by number. A name can be registered again by someone
# else after a rename or a deletion; a number is never handed out twice.
github_rule_for() {
  local ref_rule
  case "$1" in
    production) ref_rule="assertion.ref.startsWith('refs/tags/v')" ;;
    *) ref_rule="assertion.ref == 'refs/heads/main'" ;;
  esac
  printf "assertion.repository_id == '%s' && assertion.repository_owner_id == '%s' && assertion.environment == '%s' && %s" \
    "$GITHUB_REPO_ID" "$GITHUB_OWNER_ID" "$1" "$ref_rule"
}

provider_field() {
  gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" --location=global \
    --workload-identity-pool="$WIF_POOL" --format="value($1)" 2>/dev/null || true
}

if [[ "$CONFIGURE_GITHUB" == true ]]; then
  github_rule="$(github_rule_for "$GITHUB_DEPLOY_ENVIRONMENT")"
  github_mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment,attribute.ref=assertion.ref'
  github_member="principalSet://iam.googleapis.com/${WIF_POOL_PATH}/attribute.environment/${GITHUB_DEPLOY_ENVIRONMENT}"

  # A pool or provider deleted in the last 30 days still holds its name and has to be restored.
  pool_state="$(gcloud iam workload-identity-pools describe "$WIF_POOL" --location=global \
    --format='value(state)' 2>/dev/null || true)"
  case "$pool_state" in
    ACTIVE) ok "The identity pool \"${WIF_POOL}\" exists" ;;
    DELETED)
      info "Restoring the deleted identity pool \"${WIF_POOL}\""
      gcloud iam workload-identity-pools undelete "$WIF_POOL" --location=global >/dev/null
      ;;
    *)
      info "Creating the identity pool \"${WIF_POOL}\""
      gcloud iam workload-identity-pools create "$WIF_POOL" --location=global \
        --display-name='GitHub Actions' >/dev/null
      ;;
  esac

  provider_state="$(provider_field state)"
  if [[ "$provider_state" == DELETED ]]; then
    info "Restoring the deleted provider \"${WIF_PROVIDER}\""
    gcloud iam workload-identity-pools providers undelete "$WIF_PROVIDER" --location=global \
      --workload-identity-pool="$WIF_POOL" >/dev/null
  fi
  if [[ -n "$provider_state" ]]; then
    # Always written again, so a provider set up by hand with a looser rule ends up with this one.
    info "Updating the provider \"${WIF_PROVIDER}\""
    gcloud iam workload-identity-pools providers update-oidc "$WIF_PROVIDER" --location=global \
      --workload-identity-pool="$WIF_POOL" --issuer-uri="$GITHUB_ISSUER" \
      --attribute-mapping="$github_mapping" --attribute-condition="$github_rule" >/dev/null
  else
    info "Creating the provider \"${WIF_PROVIDER}\""
    gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" --location=global \
      --workload-identity-pool="$WIF_POOL" --display-name='GitHub Actions' --issuer-uri="$GITHUB_ISSUER" \
      --attribute-mapping="$github_mapping" --attribute-condition="$github_rule" >/dev/null
  fi
  ok "A token is accepted only when: ${github_rule}"

  eventually 6 10 gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
    --member="$github_member" --role=roles/iam.workloadIdentityUser --condition=None ||
    die "Could not let GitHub Actions sign in as ${DEPLOYER_SA} (see the error above)."
  ok "The \"${GITHUB_DEPLOY_ENVIRONMENT}\" environment may sign in as ${DEPLOYER_SA}"

  # Anything else from this pool that may sign in as the deployer is left over from an older, wider
  # setup (the first instructions trusted the whole repository). Tightening the rule without
  # removing those would leave a second way in.
  sign_in_members="$(gcloud iam service-accounts get-iam-policy "$DEPLOYER_SA" --flatten='bindings[].members' \
    --filter='bindings.role:roles/iam.workloadIdentityUser' --format='value(bindings.role,bindings.members)')"
  while IFS=$'\t' read -r role member; do
    [[ "$role" == 'roles/iam.workloadIdentityUser' ]] || continue
    case "$member" in
      '' | "$github_member") ;;
      "principalSet://iam.googleapis.com/${WIF_POOL_PATH}/"* | "principal://iam.googleapis.com/${WIF_POOL_PATH}/"*)
        info "Taking away an older sign-in grant: ${member##*/workloadIdentityPools/}"
        gcloud iam service-accounts remove-iam-policy-binding "$DEPLOYER_SA" --member="$member" \
          --role=roles/iam.workloadIdentityUser --all >/dev/null
        ;;
      *)
        warn "${member} may also sign in as ${DEPLOYER_SA}. This script did not add it and leaves it alone."
        follow_up "Find out why ${member} may sign in as ${DEPLOYER_SA}, and remove the grant if nobody needs it."
        ;;
    esac
  done <<<"$sign_in_members"
else
  info 'Skipped: GITHUB_REPO_ID, GITHUB_OWNER_ID and GITHUB_DEPLOY_ENVIRONMENT are not set.'
  if [[ -n "$(provider_field state)" ]]; then
    existing_rule="$(provider_field attributeCondition)"
    warn "A provider \"${WIF_PROVIDER}\" already exists and this run did not check it. Its rule is: ${existing_rule:-<none, so any GitHub repository is accepted>}"
    info 'A rule that names only the repository lets any branch or pull request deploy here.'
  fi
fi

# ------------------------------------------------------------------------------------------------
step "Publishing Firestore rules, indexes and TTL policies"
# ------------------------------------------------------------------------------------------------
# Firestore and Storage go out separately, so a problem with one cannot hold back the other.
"$FIREBASE" deploy --project "$PROJECT_ID" --only firestore --non-interactive

# TTL policies are what delete expired one-time codes and rate-limit counters. They are part of the
# indexes file and take a few minutes to become active.
ttl_fields="$(gcloud firestore fields ttls list --database='(default)' \
  --format='value(name,ttlConfig.state)' 2>/dev/null || true)"
if [[ -z "$ttl_fields" ]]; then
  warn 'The database lists no TTL policy. Expired documents will pile up.'
  follow_up 'Check the fieldOverrides with "ttl": true in firebase/firestore.indexes.json, then run: gcloud firestore fields ttls list'
else
  while IFS=$'\t' read -r field_name field_state; do
    field_name="${field_name##*/collectionGroups/}"
    ok "TTL policy on ${field_name/\/fields\//.}: ${field_state:-state unknown}"
  done <<<"$ttl_fields"
fi

step "Publishing Storage rules"
"$FIREBASE" deploy --project "$PROJECT_ID" --only storage --non-interactive

# ------------------------------------------------------------------------------------------------
step "Cleanup of old function images"
# ------------------------------------------------------------------------------------------------
# Every deploy leaves a container image behind. The repository that holds them is created by the
# first functions deploy, so on a new project there is nothing to configure yet.
if gcloud artifacts repositories describe gcf-artifacts --location="$REGION" >/dev/null 2>&1; then
  "$FIREBASE" functions:artifacts:setpolicy --project "$PROJECT_ID" --location "$REGION" \
    --days "$IMAGE_RETENTION_DAYS" --force --non-interactive
else
  info "No functions have been deployed to ${REGION} yet, so there are no images and nothing to set."
  info 'A deploy with --force, which is how CI deploys, makes the Firebase CLI delete images after 1 day.'
  follow_up "(optional) Run this script once more after the first functions deploy to keep old images for ${IMAGE_RETENTION_DAYS} days instead of 1."
fi

# ------------------------------------------------------------------------------------------------
# What is left for a person
# ------------------------------------------------------------------------------------------------

for secret in $UNSET_SECRETS; do
  case "$secret" in
    GOOGLE_MAPS_API_KEY) effect='address search uses OpenStreetMap and routes use estimates' ;;
    TWILIO_AUTH_TOKEN) effect='no SMS is sent' ;;
    *) effect='the feature that needs it stays off' ;;
  esac
  follow_up "${secret} has no value, so ${effect}. Store one with \"npx firebase functions:secrets:set ${secret} --project ${PROJECT_ID}\", then deploy the functions again: a deployed function keeps the version it was deployed with."
done

printf '\n%sDone.%s %s is set up.\n' "$GREEN" "$RESET" "$PROJECT_ID"

printf '\nValues for the variables of the GitHub environment:\n'
printf '  %-32s %s\n' 'GCP_WORKLOAD_IDENTITY_PROVIDER' "${WIF_POOL_PATH}/providers/${WIF_PROVIDER}"
printf '  %-32s %s\n' 'GCP_DEPLOY_SERVICE_ACCOUNT' "$DEPLOYER_SA"
printf '  %-32s %s\n' 'FIREBASE_PROJECT_ID' "$PROJECT_ID"
printf '  %-32s %s\n' 'FIREBASE_STORAGE_BUCKET' "$BUCKET_NAME"
printf '  %-32s %s\n' 'FUNCTIONS_REGION' "$REGION"
if [[ -n "$HOSTING_SITE" ]]; then
  printf '\nWeb address: https://%s.web.app\n' "$HOSTING_SITE"
fi

if [[ -n "$FOLLOW_UPS" ]]; then
  printf '\nNeeds attention after this run:\n%s' "$FOLLOW_UPS"
fi

readonly PROTECT_PRODUCTION='production: required reviewers, "Prevent self-review" on, no bypass for administrators, deployment tags limited to v*, and a tag ruleset that limits who may create v* tags'
readonly PROTECT_STAGING='staging: deployment branches limited to main'

TODO_NUMBER=0
todo() {
  local line
  TODO_NUMBER=$((TODO_NUMBER + 1))
  printf '  %d. %s\n' "$TODO_NUMBER" "$1"
  shift
  for line in "$@"; do printf '     %s\n' "$line"; done
}

printf '\nStill to do by hand, in this order:\n'
todo 'Firebase console → Authentication: turn on the Email/Password sign-in method, if it is not on yet.'
if [[ "$CONFIGURE_GITHUB" == true ]]; then
  if [[ "$GITHUB_DEPLOY_ENVIRONMENT" == production ]]; then protection="$PROTECT_PRODUCTION"; else protection="$PROTECT_STAGING"; fi
  todo "GitHub → Settings → Environments: make sure \"${GITHUB_DEPLOY_ENVIRONMENT}\" is protected. The sign-in rule trusts" \
    'whatever GitHub lets into that environment.' "  ${protection}"
else
  todo 'GitHub → Settings → Environments: create "staging" and "production" and protect them. Do this' \
    'first, because the sign-in rule of the next step trusts whatever GitHub lets into them.' \
    "  ${PROTECT_PRODUCTION}" "  ${PROTECT_STAGING}"
  todo 'Run this script again with GITHUB_REPO_ID, GITHUB_OWNER_ID and GITHUB_DEPLOY_ENVIRONMENT set.' \
    "Until then CI cannot sign in to ${PROJECT_ID}."
fi
todo 'Put the values printed above, and the web app config from the Firebase console, into the' \
  'variables of the matching GitHub environment (docs/DEPLOYMENT.md).'
todo 'Deploy from CI: push to main for staging, push a v* tag for production. A manually started' \
  'run can only sign in from main (staging) or from a v* tag (production).'
todo "Create the first admin: npm run create-admin -- --project ${PROJECT_ID} --email you@company.com"
todo 'App Check. The APIs are on; the rest is in the Firebase console. Register the web app with a' \
  'reCAPTCHA Enterprise key, the Android apps with Play Integrity and the iOS apps with App Attest.' \
  "Watch the metrics for a few days, then set ENFORCE_APP_CHECK=true in firebase/functions/.env.${PROJECT_ID}," \
  'deploy, and turn on enforcement for Firestore and Storage in the console.'
todo 'Cloud console → Billing → Budgets & alerts: set a budget alert.'
todo 'Restore one backup into a scratch database, so the first restore does not happen during an outage.'

printf '\nRun this script again, as an Owner, whenever MANAGED_SECRETS gets a new name or the functions get\n'
printf 'a new kind of trigger. CI cannot make those grants itself, and that is on purpose.\n'
