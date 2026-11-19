#!/usr/bin/env bash
# Stand-in for curl, used only by infra/selftest.sh. It answers the few Google REST calls that
# bootstrap-project.sh makes, from the same $FAKE_STATE files as fake-gcloud.sh.
#
# It also checks how it was called: the access token has to arrive on stdin (--config -) and must
# never be on the command line, where other users of the machine could read it.
#
# Extra files in $FAKE_STATE
#   bucket                    the JSON answer for the default bucket, once there is one
#   bucket_not_ready          lookups left during which the bucket is still being set up
#   no_storage_agent          creating the bucket does not create the Storage service agent
#   owner                     the caller may change access on the project
#   hosting_site              id of the default Hosting site
#   site_in_project_record    Firebase also reports that site on the project itself
#   no_hosting_answer         Firebase gives no answer about Hosting
set -u

STATE="$FAKE_STATE"
method=GET
data=''
output=''
url=''
config=''

case "$*" in
  *Bearer* | *ya29*) echo "TOKEN ON THE COMMAND LINE: curl $*" >>"$FAKE_LOG" ;;
esac

while (($# > 0)); do
  case "$1" in
    --request)
      method="$2"
      shift 2
      ;;
    --data)
      data="$2"
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    --config)
      config="$2"
      shift 2
      ;;
    --header | --write-out | --max-time) shift 2 ;;
    --silent | --show-error) shift ;;
    https://*)
      url="$1"
      shift
      ;;
    *)
      echo "fake curl: unknown argument $1" >&2
      exit 2
      ;;
  esac
done

token_line=''
if [[ "$config" == '-' ]]; then token_line="$(cat)"; fi
if [[ "$token_line" != 'header = "Authorization: Bearer ya29.FAKE-TOKEN"' ]]; then
  echo "NO TOKEN ON STDIN: curl ${method} ${url}" >>"$FAKE_LOG"
fi
echo "curl ${method} ${url} ${data}" >>"$FAKE_LOG"

project="$(cat "${STATE}/project_id")"
number="$(cat "${STATE}/project_number")"

# reply <status> <body>: what --output and --write-out '%{http_code}' produce
reply() {
  printf '%s' "$2" >"$output"
  printf '%s' "$1"
  exit 0
}

# Like the real services, an API that is still off answers 403.
host="${url#https://}"
host="${host%%/*}"
grep -qxF "$host" "${STATE}/apis" 2>/dev/null ||
  reply 403 "{\"error\":{\"code\":403,\"message\":\"${host} is disabled\",\"status\":\"PERMISSION_DENIED\"}}"

bucket_url="https://firebasestorage.googleapis.com/v1alpha/projects/${project}/defaultBucket"
case "${method} ${url}" in
  "GET ${bucket_url}")
    if [[ -f "${STATE}/bucket_not_ready" ]]; then
      remaining="$(cat "${STATE}/bucket_not_ready")"
      if ((remaining > 0)); then
        echo $((remaining - 1)) >"${STATE}/bucket_not_ready"
        reply 200 "{\"name\":\"projects/${project}/defaultBucket\"}"
      fi
    fi
    if [[ -f "${STATE}/bucket" ]]; then reply 200 "$(cat "${STATE}/bucket")"; fi
    reply 404 '{"error":{"code":404,"status":"NOT_FOUND"}}'
    ;;
  "POST ${bucket_url}")
    if [[ -f "${STATE}/bucket" ]]; then reply 409 '{"error":{"code":409,"status":"ALREADY_EXISTS"}}'; fi
    location="$(printf '%s' "$data" | sed -n 's/^{"location":"\([A-Za-z0-9-]*\)"}$/\1/p')"
    [[ -n "$location" ]] || reply 400 '{"error":{"code":400,"message":"the body must be {\"location\":\"...\"}"}}'
    # Cloud Storage reports locations in capitals.
    location="$(printf '%s' "$location" | tr '[:lower:]' '[:upper:]')"
    body="{\"name\":\"projects/${project}/defaultBucket\",\"location\":\"${location}\",\"bucket\":{\"name\":\"projects/${project}/buckets/${project}.firebasestorage.app\"}}"
    printf '%s' "$body" >"${STATE}/bucket"
    # The Storage service agent comes into being with the first bucket.
    if [[ ! -f "${STATE}/no_storage_agent" ]]; then
      touch "${STATE}/accounts/service-${number}@gcp-sa-firebasestorage.iam.gserviceaccount.com"
    fi
    reply 200 "$body"
    ;;
  "POST https://serviceusage.googleapis.com/v1beta1/projects/${number}/services/pubsub.googleapis.com:generateServiceIdentity")
    touch "${STATE}/accounts/service-${number}@gcp-sa-pubsub.iam.gserviceaccount.com"
    reply 200 '{"done":true}'
    ;;
  "POST https://serviceusage.googleapis.com/v1beta1/projects/${number}/services/"*":generateServiceIdentity")
    reply 200 '{"done":true}'
    ;;
  "POST https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions")
    if [[ -f "${STATE}/owner" ]]; then reply 200 '{"permissions":["resourcemanager.projects.setIamPolicy"]}'; fi
    reply 200 '{}'
    ;;
  "GET https://firebase.googleapis.com/v1beta1/projects/${project}")
    if [[ -f "${STATE}/no_hosting_answer" ]]; then reply 403 '{"error":{"code":403}}'; fi
    if [[ -f "${STATE}/hosting_site" && -f "${STATE}/site_in_project_record" ]]; then
      reply 200 "{\"projectId\":\"${project}\",\"resources\":{\"hostingSite\":\"$(cat "${STATE}/hosting_site")\"}}"
    fi
    reply 200 "{\"projectId\":\"${project}\"}"
    ;;
  "GET https://firebasehosting.googleapis.com/v1beta1/projects/${project}/sites?pageSize=100")
    if [[ -f "${STATE}/hosting_site" ]]; then
      reply 200 "{\"sites\":[{\"name\":\"projects/${project}/sites/another-site\",\"type\":\"USER_SITE\"},{\"name\":\"projects/${project}/sites/$(cat "${STATE}/hosting_site")\",\"type\":\"DEFAULT_SITE\"}]}"
    fi
    reply 200 '{}'
    ;;
esac

echo "UNEXPECTED curl ${method} ${url}" >>"$FAKE_LOG"
reply 500 '{"error":"the stand-in does not know this call"}'
