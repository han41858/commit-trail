import { NeedsHuman } from './engine.mjs';

const requiredSecrets = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AI_AUTOMATION_TOKEN',
];

// Check metadata only. Secret values are never read or included in a model context.
export async function verifyCredentialIsolation(api, { environment, base }) {
  try {
    const repository = await api('');
    if (repository.owner?.type !== 'User')
      throw new NeedsHuman(
        '워크플로 게시 전 조직에서 상속되는 Secret의 격리 상태를 별도로 확인해야 합니다.',
      );

    const repoSecrets = await api('/actions/secrets?per_page=1');
    if (repoSecrets.total_count !== 0 || repoSecrets.secrets?.length !== 0)
      throw new NeedsHuman(
        `Repository Secrets를 브랜치가 제한된 Environment로 이동하고 저장소 사본을 삭제하세요. AI 자격 증명은 ${environment} Environment에 설정해야 합니다.`,
      );

    const encoded = encodeURIComponent(environment);
    const target = await api(`/environments/${encoded}`);
    await requireBranches(api, target, [base]);
    const credentials = await api(
      `/environments/${encoded}/secrets?per_page=100`,
    );
    if (
      !Array.isArray(credentials.secrets) ||
      !requiredSecrets.every((name) =>
        credentials.secrets.some((secret) => secret.name === name),
      )
    )
      throw new NeedsHuman(
        `${environment} Environment에 OPENAI_API_KEY, ANTHROPIC_API_KEY, AI_AUTOMATION_TOKEN을 모두 설정하세요.`,
      );

    const environments = await api('/environments?per_page=100');
    if (
      !Array.isArray(environments.environments) ||
      environments.total_count !== environments.environments.length
    )
      throw new NeedsHuman('Environment 목록 전체를 확인할 수 없습니다.');
    for (const item of environments.environments) {
      if (item.name === environment) continue;
      const secrets = await api(
        `/environments/${encodeURIComponent(item.name)}/secrets?per_page=1`,
      );
      if (secrets.total_count === 0 && secrets.secrets?.length === 0) continue;
      await requireBranches(api, item, [base, 'main']);
    }
  } catch (error) {
    if (error instanceof NeedsHuman) throw error;
    throw new NeedsHuman(
      `${environment} Environment와 Secret 격리를 확인할 수 없습니다. Environment의 dev 전용 브랜치 규칙과 게시 토큰의 Actions·Secrets·Environments 읽기 권한을 확인하세요.`,
    );
  }
}

async function requireBranches(api, environment, allowed) {
  const policy = environment.deployment_branch_policy;
  if (
    policy?.protected_branches !== false ||
    policy.custom_branch_policies !== true
  )
    throw new NeedsHuman(
      `${environment.name} Environment의 Deployment branches and tags를 선택한 브랜치로 제한하세요.`,
    );
  const { total_count, branch_policies } = await api(
    `/environments/${encodeURIComponent(environment.name)}/deployment-branch-policies?per_page=100`,
  );
  if (
    !Array.isArray(branch_policies) ||
    total_count !== branch_policies.length ||
    !branch_policies.length ||
    branch_policies.some(
      (branch) => branch.type !== 'branch' || !allowed.includes(branch.name),
    )
  )
    throw new NeedsHuman(
      `${environment.name} Environment는 ${allowed.join('·')} 브랜치만 허용해야 합니다. 태그나 와일드카드는 사용할 수 없습니다.`,
    );
}
