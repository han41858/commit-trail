export const config = {
  base: 'dev',
  ciWorkflow: 'ci.yml',
  requiredJob: 'Test and build',
  maxReviews: 3,
  models: {
    codex: process.env.AI_CODEX_MODEL || 'gpt-5.3-codex',
    claude: process.env.AI_CLAUDE_MODEL || 'claude-sonnet-4-6',
  },
  instructions: 'AGENTS.md',
  editablePaths: [
    'src/',
    'docs/',
    'public/',
    'assets/',
    'README.md',
    'index.html',
  ],
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
