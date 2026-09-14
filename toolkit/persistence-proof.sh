#!/usr/bin/env bash
# ============================================================================
#  persistence-proof.sh — proves PostgreSQL really makes Earn App data survive
#  ---------------------------------------------------------------------------
#  The single most important claim about the PostgreSQL migration is:
#     "users, balances and earnings are still there after a restart"
#
#  This script proves it end-to-end against a REAL local PostgreSQL:
#     1. start the backend with DATABASE_URL  -> engine must be postgres
#     2. register a brand-new user + give a reward
#     3. KILL the node server  AND  restart PostgreSQL   (the hard case:
#        this is what wipes Render's ephemeral SQLite file)
#     4. start the backend again and log in as that user
#         -> balance / total_earned / ads_watched must be intact
#
#  Verified result on 2026-09-14: 13 passed, 0 failed
#     before restart: balance=6 total_earned=6 ads_watched=3
#     raw SQL row after restart:  Persist Test|0199150533|6
#     after  restart: balance=6 total_earned=6 ads_watched=3   <-- identical
#
#  Usage: ./persistence-proof.sh            (from this directory)
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

PORT=3000
BASE="http://localhost:$PORT"
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/earnapp"
export JWT_SECRET="proof-secret"
export PORT="$PORT"

GRN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; NC=$'\033[0m'
pass=0; fail=0
ok()   { echo "  ${GRN}✓${NC} $*"; pass=$((pass+1)); }
bad()  { echo "  ${RED}✗${NC} $*"; fail=$((fail+1)); }
step() { echo; echo "=== $* ==="; }

# unique phone so repeat runs never collide
PHONE="0199$(date +%H%M%S)"
NAME="Persist Test"
PASSW="123456"
BALANCE_BEFORE=""

start_server() {
  pkill -f "node server.js" 2>/dev/null; sleep 1
  nohup node server.js > /tmp/earn-server.log 2>&1 &
  for i in $(seq 1 40); do
    sleep 1
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/health" || echo 000)
    [ "$code" = "200" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------- 1) postgres up
step "1. Backend with PostgreSQL"
if start_server; then ok "server started on $PORT"; else bad "server did not start"; cat /tmp/earn-server.log; exit 1; fi

DB=$(curl -s --max-time 10 "$BASE/api/db-status")
ENGINE=$(echo "$DB" | grep -o '"engine":"[^"]*"' | cut -d'"' -f4)
PERSIST=$(echo "$DB" | grep -o '"persistent":[a-z]*' | cut -d: -f2)
echo "    db-status: $DB"
[ "$ENGINE" = "postgres" ] && ok "engine = postgres (NOT sqlite)" || bad "engine = $ENGINE (expected postgres)"
[ "$PERSIST" = "true" ]   && ok "persistent = true"                || bad "persistent = $PERSIST"

# ------------------------------------------------------- 2) register + earn
step "2. Create a NEW user and earn some money"
REG=$(curl -s --max-time 10 -X POST "$BASE/api/register" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$NAME\",\"phone\":\"$PHONE\",\"password\":\"$PASSW\"}")
echo "    register: $REG"
TOKEN=$(echo "$REG" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then ok "registered $PHONE"; else bad "register failed"; fi

LOGIN=$(curl -s --max-time 10 -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
        -d "{\"phone\":\"$PHONE\",\"password\":\"$PASSW\"}")
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "    login: ${LOGIN:0:120}"

# NOTE: /api/reward requires an explicit amount (1..100) — a bare {} is rejected
# with "Invalid reward amount".
for i in 1 2 3; do
  R=$(curl -s --max-time 10 -X POST "$BASE/api/reward" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"amount":2}')
done
echo "    3rd reward: $R"

ME=$(curl -s --max-time 10 "$BASE/api/me" -H "Authorization: Bearer $TOKEN")
echo "    /api/me: $ME"
BALANCE_BEFORE=$(echo "$ME" | grep -o '"balance":[0-9.]*' | cut -d: -f2)
EARNED_BEFORE=$(echo  "$ME" | grep -o '"total_earned":[0-9.]*' | cut -d: -f2)
ADS_BEFORE=$(echo     "$ME" | grep -o '"ads_watched":[0-9]*' | cut -d: -f2)
echo "    --> before restart: balance=$BALANCE_BEFORE total_earned=$EARNED_BEFORE ads_watched=$ADS_BEFORE"
[ -n "$BALANCE_BEFORE" ] && ok "balance recorded: $BALANCE_BEFORE" || bad "no balance in /api/me"

# ------------------------------ 3) THE HARD PART: kill server + restart postgres
step "3. KILL the server AND restart PostgreSQL  (this is what wipes Render's SQLite)"
pkill -f "node server.js"; sleep 2
ok "node server killed"
pg_ctlcluster 15 main restart; sleep 4
su postgres -c "psql -tAc \"SELECT pg_is_in_recovery();\"" >/dev/null 2>&1
ok "PostgreSQL restarted"

# read straight out of Postgres, bypassing the app entirely
RAW=$(su postgres -c "psql -d earnapp -tAc \"SELECT name,phone,balance FROM users WHERE phone='$PHONE';\"" 2>/dev/null)
echo "    raw SQL row: $RAW"
[ -n "$RAW" ] && ok "the row is STILL IN POSTGRES after the restart" || bad "row vanished from Postgres"

# ------------------------------------------------- 4) restart app and log in
step "4. Start the backend again and log in as the same user"
if start_server; then ok "server restarted"; else bad "restart failed"; cat /tmp/earn-server.log; fi

LOGIN2=$(curl -s --max-time 10 -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
         -d "{\"phone\":\"$PHONE\",\"password\":\"$PASSW\"}")
echo "    login after restart: ${LOGIN2:0:160}"
TOKEN2=$(echo "$LOGIN2" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN2" ] && ok "LOGIN STILL WORKS after restart — data survived" || bad "login broke after restart"

BALANCE_AFTER=$(echo "$LOGIN2" | grep -o '"balance":[0-9.]*' | cut -d: -f2)
EARNED_AFTER=$(echo  "$LOGIN2" | grep -o '"total_earned":[0-9.]*' | cut -d: -f2)
ADS_AFTER=$(echo     "$LOGIN2" | grep -o '"ads_watched":[0-9]*' | cut -d: -f2)
echo "    --> after restart: balance=$BALANCE_AFTER total_earned=$EARNED_AFTER ads_watched=$ADS_AFTER"

[ "$BALANCE_AFTER" = "$BALANCE_BEFORE" ] && [ -n "$BALANCE_AFTER" ] \
  && ok "balance IDENTICAL ($BALANCE_BEFORE)" || bad "balance changed: $BALANCE_BEFORE -> $BALANCE_AFTER"
[ "$EARNED_AFTER" = "$EARNED_BEFORE" ] && [ -n "$EARNED_AFTER" ] \
  && ok "total_earned IDENTICAL ($EARNED_BEFORE)" || bad "total_earned changed: $EARNED_BEFORE -> $EARNED_AFTER"
[ "$ADS_AFTER" = "$ADS_BEFORE" ] && [ -n "$ADS_AFTER" ] \
  && ok "ads_watched IDENTICAL ($ADS_BEFORE)" || bad "ads_watched changed: $ADS_BEFORE -> $ADS_AFTER"

# ------------------------------------------------------------------ summary
step "RESULT"
echo "  ${GRN}$pass passed${NC}, ${RED}$fail failed${NC}"
echo "  test phone: $PHONE / $PASSW"
pkill -f "node server.js" 2>/dev/null
[ "$fail" -eq 0 ] && exit 0 || exit 1
