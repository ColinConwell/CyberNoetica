#!/usr/bin/env bash
# Manage DNS records (Porkbun) and custom domains (Railway).
#
# Usage:
#   ./scripts/manage-dns.sh <command> [args]
#
# Porkbun DNS commands:
#   ping                                          Verify Porkbun API credentials
#   list   <domain>                               List all DNS records
#   get    <domain> <type> <subdomain>             Get a specific record
#   update <domain> <type> <subdomain> <content> [ttl]  Edit record by name/type
#   create <domain> <type> <subdomain> <content> [ttl]  Create a new record
#   delete <domain> <type> <subdomain>             Delete records by name/type
#
# Railway domain commands:
#   railway-add    <domain> [projectId serviceId environmentId]  Add custom domain
#   railway-status <domain> [projectId serviceId environmentId]  Check domain DNS status
#   railway-remove <domain> [projectId serviceId environmentId]  Remove custom domain
#   railway-list   [projectId environmentId serviceId]           List domains on a service
#
# Environment (read from .env.local or set directly):
#   PORKBUN_API_KEY      Porkbun API key
#   PORKBUN_SECRET_KEY   Porkbun secret key
#   RAILWAY_API_TOKEN    Railway account API token

set -euo pipefail

# ─── Load credentials ────────────────────────────────────────────────
# Source .env.local if variables aren't already in the environment.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "${PORKBUN_API_KEY:-}" ] || [ -z "${PORKBUN_SECRET_KEY:-}" ]; then
  ENV_FILE="$REPO_ROOT/.env.local"
  if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%%#*}"          # strip inline comments
      line="$(echo "$line" | xargs 2>/dev/null || true)"
      [[ -z "$line" || "$line" != *=* ]] && continue
      local_key="${line%%=*}"
      local_val="${line#*=}"
      export "$local_key=$local_val"
    done < "$ENV_FILE"
  fi
fi

PORKBUN_BASE="https://api.porkbun.com/api/json/v3"
RAILWAY_GQL="https://backboard.railway.com/graphql/v2"

require_porkbun() {
  API_KEY="${PORKBUN_API_KEY:-}"
  SECRET_KEY="${PORKBUN_SECRET_KEY:-}"
  if [ -z "$API_KEY" ] || [ -z "$SECRET_KEY" ]; then
    echo "Error: PORKBUN_API_KEY and PORKBUN_SECRET_KEY must be set" >&2
    exit 1
  fi
}

require_railway() {
  RW_TOKEN="${RAILWAY_API_TOKEN:-}"
  if [ -z "$RW_TOKEN" ]; then
    echo "Error: RAILWAY_API_TOKEN must be set (in .env.local or environment)" >&2
    exit 1
  fi
}

# ─── Helpers ──────────────────────────────────────────────────────────

auth_body() {
  printf '{"apikey":"%s","secretapikey":"%s"}' "$API_KEY" "$SECRET_KEY"
}

green() { printf "\033[32m%s\033[0m" "$1"; }
red()   { printf "\033[31m%s\033[0m" "$1"; }
bold()  { printf "\033[1m%s\033[0m" "$1"; }

# POST to Porkbun API.
api_post() {
  local endpoint="$1"
  local body="$2"
  curl -s -X POST "${PORKBUN_BASE}${endpoint}" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# POST to Railway GraphQL API.
railway_gql() {
  local query="$1"
  curl -s -X POST "$RAILWAY_GQL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RW_TOKEN" \
    -d "$query"
}

# Check a Railway GraphQL response for errors.
check_gql() {
  local resp="$1"
  local errors
  errors=$(echo "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
errs = d.get('errors')
if errs:
    print(errs[0].get('message', 'Unknown error'))
" 2>/dev/null || true)
  if [ -n "$errors" ]; then
    red "ERROR"; echo ": $errors"
    return 1
  fi
}

# Check whether a response indicates success.
check_status() {
  local resp="$1"
  local status
  status=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$status" != "SUCCESS" ]; then
    local msg
    msg=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message','Unknown error'))" 2>/dev/null || echo "Unknown error")
    red "ERROR"; echo ": $msg"
    return 1
  fi
}

# Pretty-print DNS records from a JSON response.
print_records() {
  local resp="$1"
  python3 -c "
import sys, json
data = json.load(sys.stdin)
records = data.get('records', [])
if not records:
    print('  (no records)')
    sys.exit(0)
# Column widths
w_type, w_name, w_content, w_ttl = 6, 30, 50, 6
print(f\"  {'TYPE':<{w_type}} {'NAME':<{w_name}} {'CONTENT':<{w_content}} {'TTL':<{w_ttl}} ID\")
print(f\"  {'-'*w_type} {'-'*w_name} {'-'*w_content} {'-'*w_ttl} {'-'*10}\")
for r in records:
    t = r.get('type','')
    n = r.get('name','')
    c = r.get('content','')
    ttl = r.get('ttl','')
    rid = r.get('id','')
    if len(c) > w_content:
        c = c[:w_content-3] + '...'
    if len(n) > w_name:
        n = n[:w_name-3] + '...'
    print(f'  {t:<{w_type}} {n:<{w_name}} {c:<{w_content}} {ttl:<{w_ttl}} {rid}')
" <<< "$resp"
}

# ─── Commands ─────────────────────────────────────────────────────────

cmd_ping() {
  require_porkbun
  local resp
  resp=$(api_post "/ping" "$(auth_body)")
  check_status "$resp" || return 1
  local ip
  ip=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('yourIp','?'))" 2>/dev/null)
  green "OK"; echo " -- credentials valid (your IP: $ip)"
}

cmd_list() {
  require_porkbun
  local domain="${1:?Usage: manage-dns.sh list <domain>}"
  bold "DNS records for $domain"; echo ""
  local resp
  resp=$(api_post "/dns/retrieve/$domain" "$(auth_body)")
  check_status "$resp" || return 1
  print_records "$resp"
}

cmd_get() {
  require_porkbun
  local domain="${1:?Usage: manage-dns.sh get <domain> <type> <subdomain>}"
  local rtype="${2:?Missing record type (A, CNAME, etc.)}"
  local subdomain="${3:-}"
  bold "DNS $rtype record for ${subdomain:+$subdomain.}$domain"; echo ""
  local resp
  resp=$(api_post "/dns/retrieveByNameType/$domain/$rtype/$subdomain" "$(auth_body)")
  check_status "$resp" || return 1
  print_records "$resp"
}

cmd_update() {
  require_porkbun
  local domain="${1:?Usage: manage-dns.sh update <domain> <type> <subdomain> <content> [ttl]}"
  local rtype="${2:?Missing record type}"
  local subdomain="${3?Missing subdomain (use empty string for root)}"
  local content="${4:?Missing content value}"
  local ttl="${5:-600}"

  bold "Updating $rtype record for ${subdomain:+$subdomain.}$domain"; echo ""
  echo "  -> $content (TTL $ttl)"

  local body
  body=$(printf '{"apikey":"%s","secretapikey":"%s","content":"%s","ttl":%s}' \
    "$API_KEY" "$SECRET_KEY" "$content" "$ttl")

  local resp
  resp=$(api_post "/dns/editByNameType/$domain/$rtype/$subdomain" "$body")
  check_status "$resp" || return 1
  green "OK"; echo " -- record updated"
}

cmd_create() {
  require_porkbun
  local domain="${1:?Usage: manage-dns.sh create <domain> <type> <subdomain> <content> [ttl]}"
  local rtype="${2:?Missing record type}"
  local subdomain="${3?Missing subdomain (use empty string for root)}"
  local content="${4:?Missing content value}"
  local ttl="${5:-600}"

  bold "Creating $rtype record for ${subdomain:-(root)}.$domain"; echo ""
  echo "  -> $content (TTL $ttl)"

  local body
  body=$(printf '{"apikey":"%s","secretapikey":"%s","name":"%s","type":"%s","content":"%s","ttl":%s}' \
    "$API_KEY" "$SECRET_KEY" "$subdomain" "$rtype" "$content" "$ttl")

  local resp
  resp=$(api_post "/dns/create/$domain" "$body")
  check_status "$resp" || return 1
  local rid
  rid=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null)
  green "OK"; echo " -- record created (id: $rid)"
}

cmd_delete() {
  require_porkbun
  local domain="${1:?Usage: manage-dns.sh delete <domain> <type> <subdomain>}"
  local rtype="${2:?Missing record type}"
  local subdomain="${3:-}"

  bold "Deleting $rtype record(s) for ${subdomain:-(root)}.$domain"; echo ""

  local resp
  resp=$(api_post "/dns/deleteByNameType/$domain/$rtype/$subdomain" "$(auth_body)")
  check_status "$resp" || return 1
  green "OK"; echo " -- record(s) deleted"
}

# ─── Railway Domain Commands ─────────────────────────────────────────

# Default Railway IDs from the Cybernoetica project (overridable via args).
RW_PROJECT="a1135f8f-3e5b-49b8-8947-f94822567953"
RW_SERVICE="5a0b47dd-6bbb-4c8f-bae2-84f6940bdae5"
RW_ENVIRONMENT="04c861a9-6f07-4520-8036-adfbdce386d9"

cmd_railway_add() {
  require_railway
  local domain="${1:?Usage: manage-dns.sh railway-add <domain> [projectId serviceId environmentId]}"
  local pid="${2:-$RW_PROJECT}"
  local sid="${3:-$RW_SERVICE}"
  local eid="${4:-$RW_ENVIRONMENT}"

  bold "Adding custom domain $domain to Railway service"; echo ""

  local query
  query=$(cat <<EOF
{"query":"mutation { customDomainCreate(input: { projectId: \"$pid\", environmentId: \"$eid\", serviceId: \"$sid\", domain: \"$domain\" }) { id domain status { verificationDnsHost verificationToken dnsRecords { hostlabel requiredValue status } certificateStatus } } }"}
EOF
)
  local resp
  resp=$(railway_gql "$query")
  check_gql "$resp" || return 1

  echo "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']['customDomainCreate']
print(f\"  Domain: {d['domain']}  (id: {d['id']})\")
st = d.get('status', {})
token = st.get('verificationToken')
if token:
    print('  Verification TXT:', st.get('verificationDnsHost', ''), '->', token)
for rec in st.get('dnsRecords', []):
    print(f\"  DNS: {rec['hostlabel']} -> {rec['requiredValue']} [{rec['status']}]\")
cert = st.get('certificateStatus', '?')
print(f\"  Certificate: {cert}\")
" 2>/dev/null
  green "OK"; echo " -- domain added"
}

cmd_railway_status() {
  require_railway
  local domain="${1:?Usage: manage-dns.sh railway-status <domain> [projectId serviceId environmentId]}"
  local pid="${2:-$RW_PROJECT}"
  local sid="${3:-$RW_SERVICE}"
  local eid="${4:-$RW_ENVIRONMENT}"

  bold "Custom domain status for $domain"; echo ""

  local query
  query=$(cat <<EOF
{"query":"query { domains(projectId: \"$pid\", serviceId: \"$sid\", environmentId: \"$eid\") { customDomains { id domain status { verificationDnsHost verificationToken dnsRecords { hostlabel requiredValue status } certificateStatus } } } }"}
EOF
)
  local resp
  resp=$(railway_gql "$query")
  check_gql "$resp" || return 1

  echo "$resp" | python3 -c "
import sys, json
domains = json.load(sys.stdin)['data']['domains']['customDomains']
target = '$domain'
found = [d for d in domains if d['domain'] == target]
if not found:
    print(f'  Domain {target} not found on this service')
    sys.exit(1)
for d in found:
    print(f\"  Domain: {d['domain']}  (id: {d['id']})\")
    st = d.get('status', {})
    token = st.get('verificationToken')
    if token:
        print('  Verification TXT:', st.get('verificationDnsHost', ''), '->', token)
    for rec in st.get('dnsRecords', []):
        print(f\"  DNS: {rec['hostlabel']} -> {rec['requiredValue']} [{rec['status']}]\")
    cert = st.get('certificateStatus', '?')
    print(f\"  Certificate: {cert}\")
" 2>/dev/null
}

cmd_railway_list() {
  require_railway
  local pid="${1:-$RW_PROJECT}"
  local eid="${2:-$RW_ENVIRONMENT}"
  local sid="${3:-$RW_SERVICE}"

  bold "Domains on Railway service"; echo ""

  local query
  query=$(cat <<EOF
{"query":"query { domains(projectId: \"$pid\", serviceId: \"$sid\", environmentId: \"$eid\") { customDomains { id domain status { verificationDnsHost verificationToken dnsRecords { hostlabel requiredValue status } certificateStatus } } serviceDomains { domain } } }"}
EOF
)
  local resp
  resp=$(railway_gql "$query")
  check_gql "$resp" || return 1

  echo "$resp" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']['domains']
svc = data.get('serviceDomains', [])
custom = data.get('customDomains', [])
for s in svc:
    print(f\"  {s['domain']}  (railway)\")
if not custom:
    print('  (no custom domains)')
else:
    for d in custom:
        st = d.get('status', {})
        cert = st.get('certificateStatus', '?')
        dns_ok = all(r.get('status') in ('VALID', 'DNS_RECORD_STATUS_PROPAGATED') for r in st.get('dnsRecords', []))
        dns_str = 'valid' if dns_ok else 'pending'
        print(f\"  {d['domain']}  dns={dns_str}  cert={cert}  id={d['id']}\")
" 2>/dev/null
}

cmd_railway_remove() {
  require_railway
  local domain="${1:?Usage: manage-dns.sh railway-remove <domain> [projectId serviceId environmentId]}"
  local pid="${2:-$RW_PROJECT}"
  local sid="${3:-$RW_SERVICE}"
  local eid="${4:-$RW_ENVIRONMENT}"

  bold "Removing custom domain $domain from Railway"; echo ""

  # First find the domain ID.
  local list_query
  list_query=$(cat <<EOF
{"query":"query { domains(projectId: \"$pid\", serviceId: \"$sid\", environmentId: \"$eid\") { customDomains { id domain } } }"}
EOF
)
  local list_resp domain_id
  list_resp=$(railway_gql "$list_query")
  check_gql "$list_resp" || return 1
  domain_id=$(echo "$list_resp" | python3 -c "
import sys, json
domains = json.load(sys.stdin)['data']['domains']['customDomains']
match = [d for d in domains if d['domain'] == '$domain']
print(match[0]['id'] if match else '')
" 2>/dev/null)

  if [ -z "$domain_id" ]; then
    red "ERROR"; echo ": domain $domain not found on this service"
    return 1
  fi

  local del_query
  del_query=$(cat <<EOF
{"query":"mutation { customDomainDelete(id: \"$domain_id\") }"}
EOF
)
  local del_resp
  del_resp=$(railway_gql "$del_query")
  check_gql "$del_resp" || return 1
  green "OK"; echo " -- domain removed"
}

# ─── CLI ──────────────────────────────────────────────────────────────

usage() {
  cat <<'EOF'
Usage: manage-dns.sh <command> [args]

Porkbun DNS:
  ping                                            Verify Porkbun credentials
  list   <domain>                                 List all DNS records
  get    <domain> <type> <subdomain>              Get a specific record
  update <domain> <type> <subdomain> <content> [ttl]  Edit record
  create <domain> <type> <subdomain> <content> [ttl]  Create a record
  delete <domain> <type> <subdomain>              Delete records

Railway domains:
  railway-add    <domain>                         Add custom domain to service
  railway-status <domain>                         Check domain DNS/cert status
  railway-list                                    List all custom domains
  railway-remove <domain>                         Remove custom domain

Environment (from .env.local or set directly):
  PORKBUN_API_KEY      Porkbun API key
  PORKBUN_SECRET_KEY   Porkbun secret key
  RAILWAY_API_TOKEN    Railway account token
EOF
}

cmd="${1:-}"
shift || true

case "$cmd" in
  ping)           cmd_ping ;;
  list)           cmd_list "$@" ;;
  get)            cmd_get "$@" ;;
  update)         cmd_update "$@" ;;
  create)         cmd_create "$@" ;;
  delete)         cmd_delete "$@" ;;
  railway-add)    cmd_railway_add "$@" ;;
  railway-status) cmd_railway_status "$@" ;;
  railway-list)   cmd_railway_list "$@" ;;
  railway-remove) cmd_railway_remove "$@" ;;
  -h|--help|help|"") usage ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
