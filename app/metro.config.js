// Metro config: Expo's defaults plus a cache that belongs to this project.
//
// Why: for web builds babel-preset-expo inlines the app manifest (app.config.ts → expo-constants) into
// a node_modules file at transform time, and Metro's default cache (shared by every project in the OS
// temp folder) keys that transform by file contents only. Another Expo project's manifest could then end
// up in Plans' web bundle. A project-local cache avoids that; scripts/build-web.sh also clears it.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);
config.cacheStores = [new FileStore({ root: path.join(__dirname, ".expo", "metro-cache") })];

module.exports = config;
