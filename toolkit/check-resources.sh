#!/usr/bin/env bash
# ============================================================================
#  check-resources.sh — Earn App Android resource sanity checker
#  ---------------------------------------------------------------------------
#  Catches the two failure modes that broke earlier builds (v6..v10):
#    1) DUPLICATE resource names  -> AAPT fails with "Duplicate resources"
#    2) BROKEN references         -> "resource @color/xyz not found"
#
#  Usage:   ./check-resources.sh [path-to-android-project]
#  Default: current directory
#
#  Exit code: 0 = clean, 1 = problems found
#
#  NOTE ON PORTABILITY: name extraction uses `sed`, not `grep -P` lookbehind —
#  a variable-length lookbehind like (?<=<[a-z]+ name=") is rejected by older
#  PCRE2 builds and silently returns nothing (which is how this script's first
#  revision produced 58 phantom "unresolved" hits).
# ============================================================================
set -uo pipefail

PROJ="${1:-.}"
RES="$PROJ/app/src/main/res"
MANIFEST="$PROJ/app/src/main/AndroidManifest.xml"

if [ ! -d "$RES" ]; then
  echo "ERROR: $RES not found."
  echo "Usage: ./check-resources.sh /path/to/android-project"
  exit 1
fi

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; NC=$'\033[0m'
problems=0

echo "============================================================"
echo " Earn App — resource check"
echo " project : $PROJ"
echo " res     : $RES"
echo "============================================================"

# ---------------------------------------------------------------- 1) duplicates
echo
echo "[1/3] Duplicate resource names"

for TYPE in string color style dimen bool integer array; do
  dups=$(sed -n 's/.*<'"$TYPE"' *name="\([^"]*\)".*/\1/p' "$RES"/values*/*.xml 2>/dev/null | sort | uniq -d)
  if [ -n "$dups" ]; then
    echo "  ${RED}x duplicate <${TYPE}>:${NC}"
    echo "$dups" | sed 's/^/      - /'
    problems=$((problems+1))
  fi
done

# same colour name in values/ AND res/color/ (colour-state-list clash)
sel=$(sed -n 's/.*<color name="\([^"]*\)".*/\1/p' "$RES"/color/*.xml 2>/dev/null | sort -u)
val=$(sed -n 's/.*<color name="\([^"]*\)".*/\1/p' "$RES"/values*/*.xml 2>/dev/null | sort -u)
clash=$(comm -12 <(echo "$sel") <(echo "$val") 2>/dev/null)
if [ -n "$clash" ]; then
  echo "  ${YEL}! same colour name in values/ AND res/color/:${NC}"
  echo "$clash" | sed 's/^/      - /'
  problems=$((problems+1))
fi

[ "$problems" -eq 0 ] && echo "  ${GRN}ok - no duplicates${NC}"

# ------------------------------------------------------- 2) broken references
echo
echo "[2/3] Broken references (@color/@string/@drawable/@style/...)"

defined=$(sed -n 's/.*<[A-Za-z][A-Za-z]* *name="\([^"]*\)".*/\1/p' "$RES"/values*/*.xml 2>/dev/null | sort -u)
DEFCOUNT=$(printf '%s\n' "$defined" | grep -c . )

refs=$(grep -rhoE '@(color|string|style|dimen|drawable|layout|menu|mipmap|xml|anim|font|raw|bool|integer|array)/[A-Za-z0-9_.]+' \
        "$RES" "$MANIFEST" 2>/dev/null | sed 's/^@//' | sort -u)

echo "  (definitions found: ${DEFCOUNT} | references found: $(printf '%s\n' "$refs" | grep -c .))"

miss=0
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  rtype="${ref%%/*}"
  rname="${ref#*/}"

  # library/framework styles are dotted (Widget.MaterialComponents.Button...) -> not ours
  case "$rname" in *.*) continue ;; esac

  found=0
  # (a) declared in a values*/ XML file  (string, color, style, dimen, ...)
  if echo "$defined" | grep -qx "$rname"; then found=1; fi
  # (b) file-backed resource: res/<type>/<name>.xml
  #     This also covers res/color/x.xml colour-state-lists, which are BOTH a
  #     value type and a file type — checking only (a) gave false "unresolved".
  if [ "$found" -eq 0 ]; then
    if find "$RES" -path "*/${rtype}*/*" -name "${rname}.*" 2>/dev/null | grep -q .; then found=1; fi
  fi

  if [ "$found" -eq 0 ]; then
    echo "  ${RED}x unresolved: @${ref}${NC}"
    miss=$((miss+1))
  fi
done <<< "$refs"

[ "$miss" -eq 0 ] && echo "  ${GRN}ok - every reference resolves${NC}"
problems=$((problems+miss))

# ------------------------------------------------------------- 3) signing setup
echo
echo "[3/3] Signing / keystore"
KS="$PROJ/keystore.properties"
if [ -f "$KS" ]; then
  echo "  ${GRN}ok${NC} keystore.properties present"
  grep -E 'storeFile|keyAlias' "$KS" | sed 's/^/      /'
  ksf=$(sed -n 's/^storeFile=//p' "$KS" | tr -d '[:space:]')
  if [ -n "$ksf" ] && [ -f "$PROJ/$ksf" ]; then
    echo "  ${GRN}ok${NC} keystore file found: $ksf ($(stat -c%s "$PROJ/$ksf") bytes)"
  else
    echo "  ${RED}x keystore file MISSING (storeFile=$ksf)${NC}"; problems=$((problems+1))
  fi
  if grep -q "signingConfigs" "$PROJ/app/build.gradle" 2>/dev/null; then
    echo "  ${GRN}ok${NC} app/build.gradle wires the release signingConfig"
  else
    echo "  ${RED}x app/build.gradle has no signingConfigs block${NC}"; problems=$((problems+1))
  fi
else
  echo "  ${YEL}! no keystore.properties — release build will be UNSIGNED${NC}"
fi

# --------------------------------------------------------- bonus: duplicate files
dupfiles=$(find "$RES" -name "*.xml" -printf '%h/%f\n' 2>/dev/null | sort | uniq -d)
if [ -n "$dupfiles" ]; then
  echo "  ${RED}x duplicate XML file name(s):${NC}"; echo "$dupfiles" | sed 's/^/      - /'
  problems=$((problems+1))
fi

echo
echo "============================================================"
if [ "$problems" -eq 0 ]; then
  echo " ${GRN}RESULT: CLEAN — safe to build${NC}"
  exit 0
else
  echo " ${RED}RESULT: $problems problem(s) found${NC}"
  exit 1
fi
