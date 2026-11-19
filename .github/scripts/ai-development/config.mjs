export const config = {
  base: 'dev',
  ciWorkflow: 'ci.yml',
  requiredJob: 'Test and build',
  maxReviews: 3,
  models: {
    codex: process.env.AI_CODEX_MODEL || 'gpt-5.3-codex',
    claude: process.env.AI_CLAUDE_MODEL || 'claude-sonnet-4-6',
  },
  // Provider call budget for one development or review request.
  limits: {
    turns: 30,
    outputTokens: 32_000,
    edits: 80,
    // Responses are streamed: the idle limit bounds the gap between events, the request limit the whole call.
    idleTimeout: 300_000,
    requestTimeout: 1_800_000,
    codexEffort: 'medium',
  },
  instructions: 'AGENTS.md',
  checks: [
    'npm run format:check',
    'npm test',
    'node --test --test-isolation=none .github/scripts/*.test.mjs',
    'npm run build',
  ],
};

export const agents = {
  codex: { name: 'Codex', email: 'noreply@openai.com' },
  claude: { name: 'Claude', email: 'noreply@anthropic.com' },
};
