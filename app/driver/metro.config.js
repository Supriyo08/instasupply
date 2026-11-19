// Expo configures Metro for npm-workspace monorepos automatically (SDK 52+).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
