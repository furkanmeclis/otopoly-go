let initialNativeIntent = false;

export function markInitialNativeIntent() {
  initialNativeIntent = true;
}

export function hasInitialNativeIntent() {
  return initialNativeIntent;
}
