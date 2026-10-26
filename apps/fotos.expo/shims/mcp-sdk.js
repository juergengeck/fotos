// MCP SDK shim for React Native
// The MCP SDK (Model Context Protocol) is Node.js/Electron only
// This shim prevents Metro bundler errors when code references MCP SDK
// The actual MCP code won't run on React Native - it's protected by platform checks

module.exports = {};
