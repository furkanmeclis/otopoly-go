---
name: new-screen
description: Scaffold a new Expo Router screen for Otopoly that follows the project's layout, theme tokens and UI kit. Use when adding a new page/route (list, detail or form screen) under src/app.
argument-hint: "<route path, e.g. finance/accounts> [short description]"
---

# New Otopoly screen

Create the screen described by `$ARGUMENTS`.

## 1. Place the route
- Tab screens: `src/app/(app)/(tabs)/<name>.tsx` and register a `<Tabs.Screen>` in `(tabs)/_layout.tsx`.
- Pushed screens: `src/app/(app)/<section>/index.tsx` (list) or `<section>/[id].tsx` (detail). If `(app)/_layout.tsx` lists screens explicitly, add a matching `<Stack.Screen ... options={{ presentation: 'card' }} />`.
- Navigate with `router.push('/<section>/<id>')` from `expo-router` — group segments like `(app)` and a trailing `/index` are not needed.
- Keep non-route code (components, hooks, helpers) out of `src/app/`: shared UI goes in `src/components/`, data in `src/mock/data.ts` until a real API exists.

## 2. Follow the house structure
Use `src/app/(app)/todos/index.tsx` as the reference screen:

- Root: `<SafeAreaView edges={['top']} style={styles.root}>` from `react-native-safe-area-context`, background `Colors.backgroundAlt`.
- Header row: back button (40×40, white, `Radius.lg`, bordered, `ChevronLeft` 22) → title (`FontSize.xl`, `FontWeight.extrabold`) → optional primary action (40×40, `Colors.primary`).
- Horizontal padding `Spacing.xl`; cards are white, `Radius.xl`, 1px `Colors.border`, `...Shadow.sm`, `padding: Spacing.lg`.
- Filters as pills (`Radius.full`, active = `Colors.primary`).
- Lists: `FlatList` with `keyExtractor`, `contentContainerStyle={{ paddingHorizontal: Spacing.xl, gap: Spacing.md, paddingBottom: 30 }}`.
- Empty lists: `EmptyState` from `@/components/ui`.

## 3. Reuse, don't reinvent
- Tokens only from `@/constants/theme` (`Colors`, `Spacing`, `Radius`, `FontSize`, `FontWeight`, `Shadow`) — no raw hex except `#fff`.
- UI kit from `@/components/ui`: `Badge`, `Button`, `Card`, `Divider`, `EmptyState`, `SectionHeader`, `Avatar`, `PlateBadge`, `AmountText` (money is TRY).
- Icons from `lucide-react-native`.
- All user-facing copy in Turkish; dates via `toLocaleDateString('tr-TR', ...)`.
- `StyleSheet.create` at the bottom of the file, default-exported `<Name>Screen` component.

## 4. Motion (only if it helps)
For entry/press/gesture animation use Reanimated 4 + Gesture Handler (both installed) and consult the `expo-animation` skill first. Keep animations on the UI thread and respect reduced motion.

## 5. Verify
Run `npx expo lint` and `npx tsc --noEmit`, then report the new route path.
