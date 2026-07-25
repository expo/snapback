#!/usr/bin/env bash
# Backup-store witness for the single-instance-container-vm.v1 drill: take an
# application-consistent SQLite backup of the drill database, upload it to the
# provisioned Tigris bucket (the amendment-pinned backup object store), read
# it back, and verify the hash. Emits one JSON fact object on stdout — no
# secret values, only names.
#
# This is deliberately a drill-scoped witness, NOT the LLP 0072 backup/restore
# drill corpus (immutable manifest, destroy/replace, restore-paused
# activation): that corpus stays open with the RFC. What this proves is the
# pinned bucket exists, machine credentials reach it, and a byte-exact
# read-back round-trips.
set -euo pipefail

for variable in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT_URL_S3 BUCKET_NAME; do
  if [[ -z "${!variable:-}" ]]; then
    echo "SNAPBACK_DRILL_BACKUP_ENV_MISSING: $variable" >&2
    exit 1
  fi
done

db_path="${1:-/data/drill.sqlite3}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
object_key="backups/drill-${stamp}.sqlite3"
backup_path="/tmp/drill-backup-${stamp}.sqlite3"
readback_path="/tmp/drill-readback-${stamp}.sqlite3"

sqlite3 "$db_path" ".backup '$backup_path'"
backup_sha="$(sha256sum "$backup_path" | awk '{ print $1 }')"
backup_bytes="$(stat -c %s "$backup_path")"

url="$AWS_ENDPOINT_URL_S3/$BUCKET_NAME/$object_key"
curl -fsS --aws-sigv4 "aws:amz:auto:s3" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -T "$backup_path" "$url" >/dev/null

curl -fsS --aws-sigv4 "aws:amz:auto:s3" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -o "$readback_path" "$url"
readback_sha="$(sha256sum "$readback_path" | awk '{ print $1 }')"

if [[ "$backup_sha" != "$readback_sha" ]]; then
  verdict="FAIL"
else
  verdict="PASS"
fi

cat <<JSON
{
  "kind": "tigris-backup-readback",
  "bucket": "$BUCKET_NAME",
  "endpoint": "$AWS_ENDPOINT_URL_S3",
  "objectKey": "$object_key",
  "sourceDb": "$db_path",
  "backupBytes": $backup_bytes,
  "backupSha256": "$backup_sha",
  "readbackSha256": "$readback_sha",
  "verdict": "$verdict"
}
JSON

rm -f "$backup_path" "$readback_path"
[[ "$verdict" == "PASS" ]]
