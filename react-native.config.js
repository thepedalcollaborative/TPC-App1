// Disable native iOS autolinking for react-native-reanimated.
// On iOS 26.0–26.5, RN 0.81's TurboModule interop dispatches void method
// invocations on background GCD threads. No code in this app imports
// reanimated directly, so excluding its native module is safe.
// GestureHandlerRootView is guarded in App.tsx (not rendered on iOS 26.x)
// to avoid the same background-thread crash from install() — the pod stays
// autolinked so EAS pod resolution is unaffected.
module.exports = {
  dependencies: {
    'react-native-reanimated': {
      platforms: { ios: null },
    },
  },
};
