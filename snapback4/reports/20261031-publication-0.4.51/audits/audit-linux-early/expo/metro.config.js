const { getDefaultConfig } = require("expo/metro-config");
const { withSnapback } = require("snapback4-expo/metro");
module.exports = withSnapback(getDefaultConfig(__dirname));
