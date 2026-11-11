import { pathToFileURL } from 'node:url';

export function assertMainPromotion({
  eventName,
  baseRef,
  headRef,
  headRepository,
  repository,
}) {
  if (eventName !== 'pull_request' || baseRef !== 'main') return;
  if (!repository || headRef !== 'dev' || headRepository !== repository) {
    throw new Error(
      'Main PRs must originate from this repository’s dev branch. Merge into dev first.',
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assertMainPromotion({
      eventName: process.env.GITHUB_EVENT_NAME,
      baseRef: process.env.GITHUB_BASE_REF,
      headRef: process.env.GITHUB_HEAD_REF,
      headRepository: process.env.PROMOTION_HEAD_REPOSITORY,
      repository: process.env.GITHUB_REPOSITORY,
    });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
