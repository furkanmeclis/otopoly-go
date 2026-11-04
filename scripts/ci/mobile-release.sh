#!/usr/bin/env bash
# Ships mobile/ per platform: same native fingerprint -> EAS Update (OTA); new
# fingerprint -> a store build. Android builds on EAS. iOS builds on Xcode Cloud,
# started by pushing an ios-build-<hash> tag (Tag Changes start condition), so
# that tag also records which fingerprint iOS was last built from.
#
# Env: PLATFORM=all|ios|android  FORCE_BUILD=true|false  DRY_RUN=true|false
# Run from the repo root. EAS_BIN and FINGERPRINT_BIN exist for tests.
set -euo pipefail

PLATFORM="${PLATFORM:-all}"
FORCE_BUILD="${FORCE_BUILD:-false}"
DRY_RUN="${DRY_RUN:-false}"
SHA="${SHA:-$(git rev-parse HEAD)}"
EAS_BIN="${EAS_BIN:-npx --yes eas-cli@27}"
FINGERPRINT_BIN="${FINGERPRINT_BIN:-npx expo-updates fingerprint:generate}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

case "$PLATFORM" in all | ios | android) ;; *)
  echo "::error::Unknown PLATFORM: $PLATFORM"
  exit 1
  ;;
esac

cd mobile

say() { echo "$1" | tee -a "$SUMMARY"; }
eas() { $EAS_BIN "$@"; }

# eas update does not read eas.json, so an incomplete EAS environment would ship
# an OTA in mock mode to production phones. Refuse before anything is published.
check_eas_env() {
  local vars
  vars="$(eas env:list production --scope project --format short 2>/dev/null)" || exit 1
  grep -qx 'EXPO_PUBLIC_APP_ENV=production' <<<"$vars" || missing="EXPO_PUBLIC_APP_ENV=production"
  grep -qx 'EXPO_PUBLIC_API_MODE=live' <<<"$vars" || missing="${missing:-} EXPO_PUBLIC_API_MODE=live"
  grep -qE '^EXPO_PUBLIC_API_URL=https://' <<<"$vars" || missing="${missing:-} EXPO_PUBLIC_API_URL=https://..."
  if [ -n "${missing:-}" ]; then
    echo "::error title=EAS production environment::Missing: $missing"
    exit 1
  fi
}

fingerprint() {
  $FINGERPRINT_BIN --platform "$1" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).hash))'
}

# Prints "build" or "update".
decide_android() {
  local last cmp remote local_hash
  [ "$FORCE_BUILD" = "true" ] && {
    echo build
    return
  }
  last="$(eas build:list -p android --status finished --distribution store --limit 1 --json --non-interactive 2>/dev/null |
    sed -n '/^\[/,$p' | jq -r '.[0].id // empty')" || exit 1
  if [ -z "$last" ]; then
    echo "android: no finished store build yet" >&2
    echo build
    return
  fi
  cmp="$(eas fingerprint:compare --build-id "$last" --environment production --json --non-interactive 2>/dev/null | sed -n '/^{/,$p')" || exit 1
  remote="$(jq -r '.fingerprint1.hash // empty' <<<"$cmp")"
  local_hash="$(jq -r '.fingerprint2.hash // empty' <<<"$cmp")"
  echo "android: build $last fingerprint=$remote local=$local_hash" >&2
  if [ -n "$remote" ] && [ "$remote" = "$local_hash" ]; then echo update; else echo build; fi
}

ios_tags() { git ls-remote --tags --refs origin "refs/tags/ios-build-$1*" | awk '{print $2}'; }

# Prints "build <tag>" or "update".
decide_ios() {
  local hash existing count
  hash="$(fingerprint ios | cut -c1-12)" || exit 1
  [ -n "$hash" ] || {
    echo "::error::Could not compute the iOS fingerprint" >&2
    exit 1
  }
  existing="$(ios_tags "$hash")" || exit 1
  echo "ios: fingerprint=$hash tags=[${existing//$'\n'/ }]" >&2
  if [ -z "$existing" ]; then
    echo "build ios-build-$hash"
  elif [ "$FORCE_BUILD" = "true" ]; then
    count="$(wc -l <<<"$existing" | tr -d ' ')"
    echo "build ios-build-$hash-$((count + 1))"
  else
    echo update
  fi
}

publish_update() {
  say "$1: OTA update to channel production"
  [ "$DRY_RUN" = "true" ] && return
  eas update --channel production --platform "$1" --environment production --non-interactive \
    --message "${SHA:0:8}: $(git log -1 --format=%s "$SHA" | cut -c1-100)"
}

check_eas_env

if [ "$PLATFORM" != "ios" ]; then
  # Assigned first: a failed decision must stop here and never fall through to an OTA.
  android_action="$(decide_android)"
  if [ "$android_action" = "build" ]; then
    say "android: EAS build, then submit to Play internal (draft)"
    if [ "$DRY_RUN" != "true" ]; then
      eas build -p android --profile production --auto-submit --non-interactive --no-wait
    fi
  else
    publish_update android
  fi
fi

if [ "$PLATFORM" != "android" ]; then
  ios_decision="$(decide_ios)"
  read -r action tag <<<"$ios_decision"
  if [ "$action" = "build" ]; then
    say "ios: Xcode Cloud build through tag $tag"
    if [ "$DRY_RUN" != "true" ]; then
      git push origin "$SHA:refs/tags/$tag"
    fi
  else
    publish_update ios
  fi
fi

[ "$DRY_RUN" = "true" ] && say "Dry run: nothing was published."
exit 0
