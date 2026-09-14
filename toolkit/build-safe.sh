#!/usr/bin/env bash
# ============================================================================
#  build-safe.sh — memory-safe release build for the Earn App (2 GB sandbox)
#  ---------------------------------------------------------------------------
#  WHY THIS EXISTS
#  ---------------
#  On 2026-09-13/14 the Gradle build died "Gradle build daemon disappeared
#  unexpectedly" EIGHT times (v8, v9, v10-attempts-1..5).  Root cause: the
#  sandbox cgroup caps memory at 2 GB, and the sum of
#      Gradle daemon heap + dexing worker heap + Kotlin daemon heap
#      + leftover stale daemons from earlier runs
#  overshot that cap, so the OOM killer killed the build daemon mid-task.
#
#  This script does the three things that made v11 succeed:
#      1. STOP and KILL every stale Gradle/Kotlin daemon  (frees ~1.4 GB)
#      2. VERIFY free memory before starting               (fails fast, not OOM)
#      3. Build with --no-daemon and a bounded worker count
#
#  USAGE
#  -----
#      ./build-safe.sh /workspace/build-earn-v11
#
#  IMPORTANT — how to run it from the agent shell so it does NOT hit the
#  60-second default timeout (the build needs ~80-90 s):
#
#      execute_command(command="./build-safe.sh /workspace/build-earn-v11",
#                      blocking=false, session_name="apkbuild")
#      # ... then poll:
#      check_command_output(session_name="apkbuild")
#
#  Exit code: 0 = APK produced, 1 = build failed
# ============================================================================
set -uo pipefail

PROJ="${1:-.}"
LOG_DIR="$PROJ/build-logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"

say() { echo "[build-safe] $*" | tee -a "$LOG"; }

say "=============================================================="
say " Earn App — memory-safe release build"
say " project : $PROJ"
say " log     : $LOG"
say "=============================================================="

cd "$PROJ" || { say "ERROR: cannot cd into $PROJ"; exit 1; }

# ---------------------------------------------------------------- STEP 0: memory
say ""
say "[0/4] Memory before cleanup"
free -m | tee -a "$LOG"
AVAIL_BEFORE=$(free -m | awk '/^Mem:/{print $7}')

# ------------------------------------------------- STEP 1: kill stale daemons
say ""
say "[1/4] Stopping stale Gradle / Kotlin daemons"
if [ -x ./gradlew ]; then
  ./gradlew --stop >>"$LOG" 2>&1 || true
  say "  ./gradlew --stop done"
fi
pkill -f 'GradleDaemon'           2>/dev/null && say "  killed GradleDaemon"     || say "  no GradleDaemon running"
pkill -f 'KotlinCompileDaemon'    2>/dev/null && say "  killed KotlinCompileDaemon" || say "  no KotlinCompileDaemon running"
pkill -f 'org.gradle.launcher'    2>/dev/null && say "  killed gradle launcher"  || true
sleep 3

say ""
say "[2/4] Memory after cleanup"
free -m | tee -a "$LOG"
AVAIL_AFTER=$(free -m | awk '/^Mem:/{print $7}')
say "  available: ${AVAIL_BEFORE} MB -> ${AVAIL_AFTER} MB"

# a release build of this app needs roughly 900-1200 MB free
if [ "$AVAIL_AFTER" -lt 800 ]; then
  say ""
  say "  !! only ${AVAIL_AFTER} MB available — a daemon OOM is likely."
  say "  !! free some space first, e.g.:"
  say "       rm -rf build-earn-v2 build-earn-v3 build-earn-v4   # old build dirs"
  say "       rm -rf \$PROJ/app/build                            # stale APK output"
  say "       rm -rf \$PROJ/.gradle                             # gradle cache"
  say "  !! continuing anyway — bounded heaps below give the best chance."
fi

# --------------------------------------------------------- STEP 3: sanity check
say ""
say "[3/4] Resource sanity check"
CHK="$(dirname "$0")/check-resources.sh"
if [ -x "$CHK" ]; then
  if ! "$CHK" "$PROJ" 2>&1 | tee -a "$LOG" | tail -20; then
    say "  !! resource problems found — see above. Building anyway (report only)."
  fi
else
  say "  (check-resources.sh not found next to this script — skipping)"
fi

# ------------------------------------------------------------ STEP 4: build it
say ""
say "[4/4] Gradle assembleRelease (daemon OFF, single worker)"
say "  started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
START=$(date +%s)

set -o pipefail
./gradlew assembleRelease \
    --no-daemon \
    --max-workers=1 \
    --console=plain \
    2>&1 | tee -a "$LOG"

RC=${PIPESTATUS[0]}
END=$(date +%s)
ELAPSED=$((END-START))

say ""
say "  finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)   (${ELAPSED}s)"

if [ "$RC" -ne 0 ]; then
  say ""
  say "=============================================================="
  say " BUILD FAILED (exit $RC)"
  say "=============================================================="
  if grep -q "daemon disappeared" "$LOG"; then
    say " CAUSE: Gradle daemon OOM again."
    say " FIX  : free memory (see STEP 2 hints), then re-run this script."
  else
    say " FIRST real error line:"
    grep -m1 -nE "error:|FAILURE:|What went wrong|Duplicate resources|not found" "$LOG" | sed 's/^/   /'
    say " (the first error is the cause; the rest are its fallout)"
  fi
  exit 1
fi

APK=$(find "$PROJ/app/build/outputs/apk" -name "*.apk" 2>/dev/null | head -1)
say ""
say "=============================================================="
say " BUILD SUCCESSFUL in ${ELAPSED}s"
say "=============================================================="
if [ -n "$APK" ]; then
  say " APK : $APK   ($(stat -c%s "$APK") bytes)"
  say " SHA256: $(sha256sum "$APK" | awk '{print $1}')"
  say ""
  say " Verify signature with:"
  say "   \$ANDROID_HOME/build-tools/*/apksigner verify --print-certs \"$APK\""
else
  say " !! build reported success but no APK found — check $LOG"
  exit 1
fi
exit 0
