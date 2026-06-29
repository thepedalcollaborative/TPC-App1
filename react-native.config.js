// Disable native autolinking for react-native-reanimated on iOS.
// On iOS 26.4.x and 26.5.x, the RN TurboModule interop dispatches void
// method invocations on background threads. RNReanimated's native module
// triggers this crash during animation frame initialization. Build 28
// (the last stable build) did not have RNReanimated in its Podfile.lock.
// All gesture-handler usage in this app works without the reanimated
// native module — no code directly imports react-native-reanimated.
module.exports = {
  dependencies: {
    'react-native-reanimated': {
      platforms: {
        ios: null,
      },
    },
  },
};
