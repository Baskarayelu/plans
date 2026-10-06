/** Unit tests for the pure modules (crypto, encoders, money, settlement). */
module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@noble/.*|@scure/.*|viem|ox|abitype|@category-labs/.*|@adraffy/.*)",
  ],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
