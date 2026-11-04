#!/bin/sh
# Xcode Cloud: runs before xcodebuild. Uses the Xcode Cloud build number as
# CFBundleVersion so every TestFlight upload is unique without manual bumps.
set -eu

if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  echo "==> Setting CFBundleVersion to $CI_BUILD_NUMBER"
  for plist in "$CI_PRIMARY_REPOSITORY_PATH"/ios/*/Info.plist; do
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $CI_BUILD_NUMBER" "$plist" && echo "    $plist"
  done
fi
