import 'expo-router/entry';
// Background push task (Live Updates / widgets, docs/LIVE_WIDGETS.md): defined at module scope while the
// bundle loads, so it also runs when the OS starts the app in the background (expo-task-manager).
import './src/features/widgets/background-push';
