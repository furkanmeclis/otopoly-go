#!/bin/sh
# Xcode Cloud: runs right after the repo is cloned, before xcodebuild.
# mobile/ios/ is not committed (Expo CNG), so this regenerates the native project and
# installs pods. Source of truth: mobile/scripts/xcode-cloud/ (copied into mobile/ios/ci_scripts
# by plugins/with-xcode-cloud.js on every prebuild, so --clean keeps these scripts).
set -eu

echo "==> ci_post_clone: starting"
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile"

# Apple sets CI=TRUE; some JS tools expect a real boolean.
export CI=true
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_ENV_HINTS=1

# Node 20+ is required by Expo SDK 57.
brew install node@22 cocoapods || brew install node cocoapods
brew link --overwrite --force node@22 2>/dev/null || true
echo "==> node $(node -v) / npm $(npm -v) / pod $(pod --version)"

npm ci --no-audit --no-fund

# Compared with the fingerprint the CI release job computes (mobile-release).
echo "==> ios fingerprint: $(npx expo-updates fingerprint:generate --platform ios | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).hash))')"

npx expo prebuild --platform ios --clean --no-install

# React Native build phases need an explicit Node path inside Xcode.
echo "export NODE_BINARY=$(command -v node)" > ios/.xcode.env.local

cd ios
pod install

echo "==> ci_post_clone: done"
ls -d ./*.xcworkspace
