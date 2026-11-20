// Entry point (package.json "main"). The background location task must be defined before the router
// loads, because Android can start this bundle headlessly (no UI, no route module evaluated) to deliver
// location updates after the process was killed (code review R60, R62). Metro resolves the `.native.ts`
// task on Android and iOS and the no-op stub on web. Keep `expo-router/entry` last.
import './src/features/location/background-task';
import 'expo-router/entry';
