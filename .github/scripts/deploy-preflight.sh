#!/usr/bin/env bash
# Checks the deploy settings before anything is installed, built or uploaded.
#
# Why: the back office bakes its Firebase settings in at build time and quietly falls back to the
# local emulator values when one is missing (apps/backoffice/src/lib/env.ts). A forgotten GitHub
# variable would publish a console that loads and then cannot reach the project. The functions region
# is the worst case: a console built for one region cannot call functions deployed to another, so
# every action in it fails. This script turns those mistakes into a job that stops in seconds.
#
# Reads, from the GitHub environment's variables (deploy.yml passes them in):
#   TARGET                           staging | production
#   GCP_WORKLOAD_IDENTITY_PROVIDER   GCP_DEPLOY_SERVICE_ACCOUNT
#   FIREBASE_PROJECT_ID              FIREBASE_API_KEY          FIREBASE_AUTH_DOMAIN
#   FIREBASE_STORAGE_BUCKET          FIREBASE_APP_ID
#   FUNCTIONS_REGION                 required on production; staging falls back to us-central1
# Writes `functions_region=<region>` to $GITHUB_OUTPUT for the back office build.
#
# It only reads files, so it is safe to run by hand from the repo root:
#   TARGET=staging FIREBASE_PROJECT_ID=my-project ... bash .github/scripts/deploy-preflight.sh
set -euo pipefail

FUNCTIONS_DIR="firebase/functions" # `functions[].source` in firebase.json
# What the functions and the apps use when no region is configured (DEFAULT_FUNCTIONS_REGION in
# packages/shared). Staging and production set their own region; this is only the fallback.
DEFAULT_REGION="us-central1"

problems=0
problem() { # problem <title> <message>: report it and keep going, so one run lists everything
  echo "::error title=$1::$2"
  problems=$((problems + 1))
}

target="${TARGET:-}"
if [[ "$target" != staging && "$target" != production ]]; then
  echo "::error title=Unknown deploy target::TARGET must be staging or production, but it is '${target}'."
  exit 1
fi

missing=()
for name in GCP_WORKLOAD_IDENTITY_PROVIDER GCP_DEPLOY_SERVICE_ACCOUNT FIREBASE_PROJECT_ID FIREBASE_API_KEY \
  FIREBASE_AUTH_DOMAIN FIREBASE_STORAGE_BUCKET FIREBASE_APP_ID; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if ((${#missing[@]} > 0)); then
  problem "Variables missing on the ${target} environment" \
    "Not set: ${missing[*]}. Add them in GitHub under Settings, Environments, ${target}, Environment variables. docs/DEPLOYMENT.md says where each value comes from."
fi

# The id becomes part of a file name below, so a pasted URL or a stray space must not get that far.
project="${FIREBASE_PROJECT_ID:-}"
project_pattern='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
if [[ -n "$project" && ! "$project" =~ $project_pattern ]]; then
  problem "FIREBASE_PROJECT_ID is not a project id" \
    "'${project}' is not a Google Cloud project id (6 to 30 lowercase letters, digits and hyphens). Use the id shown in the Firebase console's project settings, not the name or the number."
  project=""
fi

region="${FUNCTIONS_REGION:-}"
region_source="the FUNCTIONS_REGION variable on the ${target} environment"
region_pattern='^[a-z]+(-[a-z]+)+[0-9]+$'
if [[ -z "$region" ]]; then
  if [[ "$target" == production ]]; then
    problem "FUNCTIONS_REGION is not set on the production environment" \
      "Production has no default region, because a console built for the wrong region cannot call a single function. Set the FUNCTIONS_REGION environment variable to the region the functions deploy to: the FUNCTIONS_REGION line in ${FUNCTIONS_DIR}/.env.${project:-PROJECT_ID}."
  else
    echo "::warning title=FUNCTIONS_REGION is not set on the staging environment::Building the back office for ${DEFAULT_REGION}. Set the FUNCTIONS_REGION environment variable to say so explicitly."
    region="$DEFAULT_REGION"
    region_source="the fallback, because FUNCTIONS_REGION is not set on the ${target} environment"
  fi
elif [[ ! "$region" =~ $region_pattern ]]; then
  problem "FUNCTIONS_REGION is not a region name" \
    "'${region}' does not look like a Cloud Functions region such as northamerica-northeast2. Check the variable for typos and spaces."
  region=""
fi

# Prints the FUNCTIONS_REGION a dotenv file sets (its last assignment), or nothing.
region_in() {
  local value
  value=$(sed -n -E 's/^[[:space:]]*FUNCTIONS_REGION[[:space:]]*=(.*)$/\1/p' "$1" | tail -n 1)
  value=${value%%#*} # a region never contains '#', so the rest of the line is a comment
  printf '%s' "$value" | tr -d "\"' \t\r"
}

# The functions get their settings from .env and then .env.<project-id>; the later file wins
# (firebase-tools, functions/env.js). Compare what they will deploy with against what the console
# is about to be built for.
if [[ -n "$project" ]]; then
  project_env="${FUNCTIONS_DIR}/.env.${project}"
  if [[ ! -f "$project_env" ]]; then
    problem "No functions settings for ${project}" \
      "${project_env} does not exist, so the functions would deploy with their built-in defaults instead of this project's region and settings. The file is named after the project id: rename the one you copied, or add it."
  elif [[ -n "$region" ]]; then
    functions_region="$DEFAULT_REGION"
    functions_source="the default, because ${project_env} does not set FUNCTIONS_REGION"
    for file in "${FUNCTIONS_DIR}/.env" "$project_env"; do
      [[ -f "$file" ]] || continue
      found=$(region_in "$file")
      if [[ -n "$found" ]]; then
        functions_region="$found"
        functions_source="$file"
      fi
    done
    if [[ "$functions_region" != "$region" ]]; then
      problem "The back office and the functions disagree on the region" \
        "The back office would be built for ${region} (${region_source}), but the functions deploy to ${functions_region} (${functions_source}). Make the two agree."
    fi
  fi
fi

if ((problems > 0)); then
  echo "Stopped before installing, building or uploading anything: ${problems} problem(s), listed above."
  exit 1
fi

echo "functions_region=${region}" >>"${GITHUB_OUTPUT:-/dev/stdout}"
echo "Settings look right: ${target}, project ${project}, functions region ${region}."
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Deploying \`${GITHUB_SHA:-this commit}\` to **${target}**: project \`${project}\`, functions region \`${region}\`." >>"$GITHUB_STEP_SUMMARY"
fi
