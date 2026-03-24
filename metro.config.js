const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Resolve react-native field first so Supabase's `ws` dep
// gets the React Native-compatible shim instead of the Node.js version.
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

module.exports = config;
