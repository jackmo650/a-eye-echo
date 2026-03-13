// ============================================================================
// App Config — Extends app.json with environment variables
//
// API keys are injected via EAS Environment Variables (set in EAS dashboard),
// NOT committed to git. This keeps secrets out of the repo while baking them
// into the app bundle at build time.
//
// To set the DeepL key for EAS builds:
//   eas env:create --name DEEPL_API_KEY --value "your-key" --environment preview --visibility secret
//
// For local dev, use src/config/secrets.ts (gitignored).
// ============================================================================

const baseConfig = require('./app.json');

module.exports = ({ config }) => {
  return {
    ...baseConfig.expo,
    ...config,
    extra: {
      ...baseConfig.expo.extra,
      ...config.extra,
      // Injected from EAS Environment Variables at build time
      DEEPL_API_KEY: process.env.DEEPL_API_KEY || '',
    },
  };
};
