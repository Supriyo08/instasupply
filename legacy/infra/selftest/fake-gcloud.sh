#!/usr/bin/env bash
# Stand-in for gcloud, used only by infra/selftest.sh.
#
# It keeps a made-up project as plain files in $FAKE_STATE and answers the gcloud commands that
# bootstrap-project.sh runs. It is strict on purpose: a flag the real command needs, an API that is
# still off, or an account that does not exist yet is an error here too, so a step that runs too
# early or forgets a flag fails the self-test. Every call is appended to $FAKE_LOG.
#
# This file is what we believe gcloud does. A passing self-test proves the bootstrap's own logic and
# the order of its steps. It does not prove that Google's commands behave like this file.
#
# Files in $FAKE_STATE
#   account, project_id, project_number, billing   who is signed in, which project exists
#   apis                                           one switched-on API per line
#   refuse_apis                                    APIs that cannot be switched on
#   database                                       location, type, recovery, delete protection (tabs)
#   backup_schedules                               name, retention, weekday (tabs; daily has no weekday)
#   ttl                                            field name, state (tabs)
#   accounts/<email>                               service accounts that exist
#   slow_accounts/<email>                          lookups left before that account appears
#   policy/project, policy/bucket                  one "role member" per line
#   policy/account/<email>, policy/secret/<name>   the same, for one account or one secret
#   secrets/<name>/<n>                             the payload of version n
#   unreadable_secrets/<name>                      the newest version of that secret is disabled
#   pool, provider_state, provider_rule, provider_mapping
#   image_repository                               exists once functions have been deployed
#   old_gcloud                                     this gcloud predates Firestore backup schedules
set -u

STATE="$FAKE_STATE"
PROJECT="${CLOUDSDK_CORE_PROJECT:-}"
echo "gcloud $*" >>"$FAKE_LOG"

fail() {
  echo "ERROR: (fake gcloud) $*" >&2
  exit 1
}

# flag <name> "$@": prints the value of --name=value
flag() {
  local name="$1" argument
  shift
  for argument in "$@"; do
    case "$argument" in
      "--${name}="*)
        printf '%s' "${argument#*=}"
        return 0
        ;;
    esac
  done
  return 1
}

has() {
  local wanted="$1" argument
  shift
  for argument in "$@"; do
    if [[ "$argument" == "$wanted" ]]; then return 0; fi
  done
  return 1
}

api_on() { grep -qxF "$1" "${STATE}/apis" 2>/dev/null; }
needs_api() { api_on "$1" || fail "API [$1] not enabled on project [${PROJECT}]"; }
needs_project() { [[ -n "$PROJECT" ]] || fail 'no project: CLOUDSDK_CORE_PROJECT is not set'; }
account_exists() { [[ -e "${STATE}/accounts/$1" ]]; }

# IAM refuses a grant to a service account that does not exist.
needs_member() {
  case "$1" in
    serviceAccount:*) account_exists "${1#serviceAccount:}" || fail "INVALID_ARGUMENT: Service account ${1#serviceAccount:} does not exist." ;;
  esac
}

# grant <policy file> "$@": adds the --role/--member pair. An unconditional grant must say so.
grant() {
  local file="$1" role member
  shift
  has --condition=None "$@" || fail 'adding a binding without --condition=None'
  role="$(flag role "$@")" || fail 'missing --role'
  member="$(flag member "$@")" || fail 'missing --member'
  needs_member "$member"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  grep -qxF "${role} ${member}" "$file" || echo "${role} ${member}" >>"$file"
}

revoke() {
  local file="$1" role member
  shift
  role="$(flag role "$@")" || fail 'missing --role'
  member="$(flag member "$@")" || fail 'missing --member'
  grep -qxF "${role} ${member}" "$file" 2>/dev/null ||
    fail 'Policy binding with the specified principal, role, and condition not found!'
  grep -vxF "${role} ${member}" "$file" >"${file}.next" || true
  mv "${file}.next" "$file"
}

# list_grants <policy file> "$@": "role<TAB>member" for every role that contains the text after
# "bindings.role:" in --filter. The real ":" operator also matches loosely, so the caller has to
# compare exactly.
list_grants() {
  local file="$1" filter
  shift
  [[ "$(flag format "$@")" == 'value(bindings.role,bindings.members)' ]] || fail 'unexpected --format for a policy'
  filter="$(flag filter "$@")" || fail 'missing --filter'
  [[ -f "$file" ]] || return 0
  awk -v wanted="${filter#bindings.role:}" 'index($1, wanted) { printf "%s\t%s\n", $1, $2 }' "$file"
}

newest_version() { find "${STATE}/secrets/$1" -type f 2>/dev/null | sed 's|.*/||' | sort -n | tail -n 1; }

# Help needs no project and no API. An old gcloud would not know the newest command asked about.
if has --help "$@"; then
  if [[ -f "${STATE}/old_gcloud" ]]; then fail "Invalid choice: '$3'"; fi
  exit 0
fi

case "$1 ${2:-} ${3:-} ${4:-}" in
  'config get-value account '*)
    if [[ -f "${STATE}/account" ]]; then cat "${STATE}/account"; fi
    ;;
  'auth print-access-token '*)
    [[ -f "${STATE}/account" ]] || fail 'not signed in'
    echo 'ya29.FAKE-TOKEN'
    ;;
  'projects describe '*)
    [[ "$3" == "$(cat "${STATE}/project_id")" ]] || fail "project $3 not found"
    cat "${STATE}/project_number"
    ;;
  'billing projects describe '*)
    cat "${STATE}/billing"
    ;;
  'services enable '*)
    needs_project
    shift 2
    (($# <= 20)) || fail 'a request can enable at most 20 services'
    for api in "$@"; do
      if grep -qxF "$api" "${STATE}/refuse_apis" 2>/dev/null; then fail "Permission denied to enable service [${api}]"; fi
    done
    for api in "$@"; do
      api_on "$api" || echo "$api" >>"${STATE}/apis"
    done
    # The Compute Engine API brings the default service account with it.
    if has compute.googleapis.com "$@"; then touch "${STATE}/accounts/$(cat "${STATE}/project_number")-compute@developer.gserviceaccount.com"; fi
    ;;

  'firestore databases list '*)
    needs_api firestore.googleapis.com
    if [[ -f "${STATE}/database" ]]; then echo "projects/${PROJECT}/databases/(default)"; fi
    ;;
  'firestore databases describe '*)
    needs_api firestore.googleapis.com
    [[ -f "${STATE}/database" ]] || fail 'NOT_FOUND: no database'
    cat "${STATE}/database"
    ;;
  'firestore databases create '*)
    needs_api firestore.googleapis.com
    [[ ! -f "${STATE}/database" ]] || fail 'ALREADY_EXISTS: database'
    location="$(flag location "$@")" || fail '--location is required'
    [[ "$(flag database "$@")" == '(default)' && "$(flag type "$@")" == 'firestore-native' ]] || fail 'unexpected create flags'
    recovery=POINT_IN_TIME_RECOVERY_DISABLED
    protection=DELETE_PROTECTION_DISABLED
    if has --enable-pitr "$@"; then recovery=POINT_IN_TIME_RECOVERY_ENABLED; fi
    if has --delete-protection "$@"; then protection=DELETE_PROTECTION_ENABLED; fi
    printf '%s\tFIRESTORE_NATIVE\t%s\t%s\n' "$location" "$recovery" "$protection" >"${STATE}/database"
    ;;
  'firestore databases update '*)
    needs_api firestore.googleapis.com
    IFS=$'\t' read -r location type recovery protection <"${STATE}/database"
    if has --enable-pitr "$@"; then recovery=POINT_IN_TIME_RECOVERY_ENABLED; fi
    if has --delete-protection "$@"; then protection=DELETE_PROTECTION_ENABLED; fi
    printf '%s\t%s\t%s\t%s\n' "$location" "$type" "$recovery" "$protection" >"${STATE}/database"
    ;;
  'firestore backups schedules list')
    needs_api firestore.googleapis.com
    if [[ -f "${STATE}/backup_schedules" ]]; then cat "${STATE}/backup_schedules"; fi
    ;;
  'firestore backups schedules create')
    needs_api firestore.googleapis.com
    [[ "$(flag recurrence "$@")" == daily && "$(flag retention "$@")" == 14d ]] || fail 'unexpected schedule flags'
    if grep -q "$(printf '\t')\$" "${STATE}/backup_schedules" 2>/dev/null; then fail 'a daily schedule already exists'; fi
    printf 'projects/%s/databases/(default)/backupSchedules/daily\t1209600s\t\n' "$PROJECT" >>"${STATE}/backup_schedules"
    ;;
  'firestore fields ttls list')
    needs_api firestore.googleapis.com
    if [[ -f "${STATE}/ttl" ]]; then cat "${STATE}/ttl"; fi
    ;;

  'iam service-accounts describe '*)
    needs_api iam.googleapis.com
    if [[ -f "${STATE}/slow_accounts/$4" ]]; then
      remaining="$(cat "${STATE}/slow_accounts/$4")"
      if ((remaining > 0)); then
        echo $((remaining - 1)) >"${STATE}/slow_accounts/$4"
        fail "NOT_FOUND: Unknown service account $4"
      fi
      touch "${STATE}/accounts/$4"
    fi
    account_exists "$4" || fail "NOT_FOUND: Unknown service account $4"
    ;;
  'iam service-accounts create '*)
    needs_api iam.googleapis.com
    needs_project
    touch "${STATE}/accounts/$4@${PROJECT}.iam.gserviceaccount.com"
    ;;
  'iam service-accounts add-iam-policy-binding '*)
    account_exists "$4" || fail "NOT_FOUND: service account $4"
    grant "${STATE}/policy/account/$4" "$@"
    ;;
  'iam service-accounts get-iam-policy '*)
    list_grants "${STATE}/policy/account/$4" "$@"
    ;;
  'iam service-accounts remove-iam-policy-binding '*)
    revoke "${STATE}/policy/account/$4" "$@"
    ;;

  'projects add-iam-policy-binding '*)
    grant "${STATE}/policy/project" "$@"
    ;;
  'projects get-iam-policy '*)
    list_grants "${STATE}/policy/project" "$@"
    ;;
  'projects remove-iam-policy-binding '*)
    revoke "${STATE}/policy/project" "$@"
    ;;

  'storage buckets add-iam-policy-binding '*)
    grant "${STATE}/policy/bucket" "$@"
    ;;
  'storage buckets describe '*)
    echo 'NORTHAMERICA-NORTHEAST2'
    ;;

  'secrets list '*)
    needs_api secretmanager.googleapis.com
    ;;
  'secrets describe '*)
    needs_api secretmanager.googleapis.com
    [[ -d "${STATE}/secrets/$3" ]] || fail "NOT_FOUND: secret $3"
    ;;
  'secrets create '*)
    needs_api secretmanager.googleapis.com
    [[ ! -d "${STATE}/secrets/$3" ]] || fail "ALREADY_EXISTS: secret $3"
    mkdir -p "${STATE}/secrets/$3"
    ;;
  'secrets versions list '*)
    newest_version "$4"
    ;;
  'secrets versions access '*)
    [[ "$4" == latest ]] || fail 'expected "latest"'
    name="$(flag secret "$@")" || fail 'missing --secret'
    version="$(newest_version "$name")"
    [[ -n "$version" ]] || fail 'NOT_FOUND: no versions'
    [[ ! -e "${STATE}/unreadable_secrets/${name}" ]] || fail 'FAILED_PRECONDITION: the version is DISABLED'
    cat "${STATE}/secrets/${name}/${version}"
    ;;
  'secrets versions add '*)
    [[ -d "${STATE}/secrets/$4" ]] || fail "NOT_FOUND: secret $4"
    [[ "$(flag data-file "$@")" == '-' ]] || fail 'expected --data-file=-'
    version="$(newest_version "$4")"
    version=$((${version:-0} + 1))
    cat >"${STATE}/incoming"
    [[ -s "${STATE}/incoming" ]] || fail 'INVALID_ARGUMENT: Secret Payload cannot be empty.'
    mv "${STATE}/incoming" "${STATE}/secrets/$4/${version}"
    ;;
  'secrets add-iam-policy-binding '*)
    [[ -d "${STATE}/secrets/$3" ]] || fail "NOT_FOUND: secret $3"
    grant "${STATE}/policy/secret/$3" "$@"
    ;;

  'iam workload-identity-pools describe '*)
    [[ -f "${STATE}/pool" ]] || fail 'NOT_FOUND: pool'
    cat "${STATE}/pool"
    ;;
  'iam workload-identity-pools create '*)
    [[ ! -f "${STATE}/pool" ]] || fail 'ALREADY_EXISTS: pool'
    echo ACTIVE >"${STATE}/pool"
    ;;
  'iam workload-identity-pools undelete '*)
    echo ACTIVE >"${STATE}/pool"
    ;;
  'iam workload-identity-pools providers describe')
    [[ -f "${STATE}/provider_state" ]] || fail 'NOT_FOUND: provider'
    case "$(flag format "$@")" in
      'value(state)') cat "${STATE}/provider_state" ;;
      'value(attributeCondition)') if [[ -f "${STATE}/provider_rule" ]]; then cat "${STATE}/provider_rule"; fi ;;
      *) fail 'unexpected --format for a provider' ;;
    esac
    ;;
  'iam workload-identity-pools providers create-oidc' | 'iam workload-identity-pools providers update-oidc')
    if [[ "$4" == create-oidc && -f "${STATE}/provider_state" ]]; then fail 'ALREADY_EXISTS: provider'; fi
    if [[ "$4" == update-oidc && ! -f "${STATE}/provider_state" ]]; then fail 'NOT_FOUND: provider'; fi
    [[ "$(flag issuer-uri "$@")" == 'https://token.actions.githubusercontent.com' ]] || fail 'unexpected issuer'
    echo ACTIVE >"${STATE}/provider_state"
    flag attribute-condition "$@" >"${STATE}/provider_rule"
    flag attribute-mapping "$@" >"${STATE}/provider_mapping"
    ;;
  'iam workload-identity-pools providers undelete')
    echo ACTIVE >"${STATE}/provider_state"
    ;;

  'artifacts repositories describe '*)
    needs_api artifactregistry.googleapis.com
    [[ -f "${STATE}/image_repository" ]] || fail 'NOT_FOUND: repository'
    ;;

  *)
    echo "UNEXPECTED gcloud $*" >>"$FAKE_LOG"
    fail "the stand-in does not know: gcloud $*"
    ;;
esac
