module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    openaiApiKey: process.env.OPENAI_API_KEY || '',
  },
});
