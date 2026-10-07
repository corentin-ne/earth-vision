module.exports = function (api) {
  api.cache(true);

  const plugins = [
    'react-native-reanimated/plugin', // Must be last Babel plugin
  ];

  // Strip all console.* calls in production builds.
  // Eliminates runtime string formatting overhead and prevents
  // accidental log leaks to user-visible consoles.
  if (process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production') {
    plugins.unshift('transform-remove-console');
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
