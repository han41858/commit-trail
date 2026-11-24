const formatCheck = './node_modules/.bin/prettier . --check';

export const config = {
  base: 'dev',
  ciWorkflow: 'ci.yml',
  requiredJob: 'Test and build',
  maxReviews: 3,
  maxUnpublishedRestarts: 1,
  maxBaseRefreshes: 2,
  maxModelSessions: 26,
  models: {
    codex: process.env.AI_CODEX_MODEL || 'gpt-6.2-sol',
    claude: process.env.AI_CLAUDE_MODEL || 'claude-sonnet-5-5',
  },
  // Provider call budget for one development or review request.
  limits: {
    turns: 30,
    reviewTurns: 45,
    outputTokens: 32_000,
    edits: 80,
    // Responses are streamed: the idle limit bounds the gap between events, the request limit the whole call.
    idleTimeout: 300_000,
    requestTimeout: 1_800_000,
    codexEffort: 'medium',
  },
  instructions: 'AGENTS.md',
  credentialsEnvironment: 'ai-development',
  docsOnlyChecks: [formatCheck],
  checks: [
    formatCheck,
    './node_modules/.bin/tsx --test "src/**/*.test.ts"',
    'node --test --test-isolation=none .github/scripts/*.test.mjs',
    './node_modules/.bin/tsc -b && ./node_modules/.bin/vite build',
  ],
};

export const agents = {
  codex: { name: 'Codex', email: 'noreply@openai.com' },
  claude: { name: 'Claude', email: 'noreply@anthropic.com' },
};
