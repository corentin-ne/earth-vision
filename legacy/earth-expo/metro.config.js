const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow importing GLSL shader files as raw text strings
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => !['vert', 'frag', 'glsl'].includes(ext),
);
config.resolver.sourceExts.push('vert', 'frag', 'glsl');

// Allow importing .json files (for TopoJSON data)
if (!config.resolver.sourceExts.includes('json')) {
  config.resolver.sourceExts.push('json');
}

module.exports = config;
