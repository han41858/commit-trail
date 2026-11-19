import { setTimeout as wait } from 'node:timers/promises';
import { agents, config } from './config.mjs';

const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: 'string' };
const integer = { type: 'integer' };
const nullableText = { anyOf: [string, { type: 'null' }] };

export const developmentSchema = object({
  status: { type: 'string', enum: ['completed', 'needs_human'] },
  title: string,
  summary: string,
  edits: {
    type: 'array',
    items: object({ path: string, before: nullableText, after: nullableText }),
  },
});

export const reviewSchema = object({
  status: {
    type: 'string',
    enum: ['pass', 'changes_requested', 'needs_human'],
  },
  summary: string,
  findings: {
    type: 'array',
    items: object({
      path: string,
      line: integer,
      defect: string,
      impact: string,
      evidence: string,
      fix: string,
    }),
  },
});

const tools = {
  list_files: {
    description:
      'Find tracked paths by case-insensitive substring. Use offset 0 for the first page.',
    input: object({ query: string, offset: integer }),
  },
  read_file: {
    description:
      'Read tracked UTF-8 text with line numbers. Use line 1 to start.',
    input: object({ path: string, line: integer }),
  },
  read_diff: {
    description:
      'Read the complete PR diff from the original base to the current HEAD, paged by line.',
    input: object({ line: integer }),
  },
};

function validate(value, schema, label) {
  if (schema.anyOf) {
    if (value === null || typeof value === 'string') return;
  } else if (
    schema.type === 'object' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    if (
      Object.keys(value).length === schema.required.length &&
      schema.required.every((key) => Object.hasOwn(value, key))
    ) {
      for (const [key, child] of Object.entries(schema.properties))
        validate(value[key], child, `${label}.${key}`);
      return;
    }
  } else if (schema.type === 'array' && Array.isArray(value)) {
    for (const item of value) validate(item, schema.items, label);
    return;
  } else if (schema.type === 'integer' && Number.isSafeInteger(value)) {
    return;
  } else if (
    schema.type === 'string' &&
    typeof value === 'string' &&
    (!schema.enum || schema.enum.includes(value))
  ) {
    return;
  }
  throw new Error(`AI 결과의 JSON 형식이 올바르지 않습니다 (${label}).`);
}

export function validateReview(value) {
  validate(value, reviewSchema, 'review');
  if (
    !value.summary.trim() ||
    value.summary.length > 900 ||
    value.findings.length > 6 ||
    (value.status === 'pass' && value.findings.length) ||
    (value.status === 'changes_requested' && !value.findings.length)
  ) {
    throw new Error(
      '리뷰 상태와 지적 사항이 일치하지 않거나 결과가 너무 깁니다.',
    );
  }
  for (const { line, ...fields } of value.findings) {
    if (
      line < 1 ||
      Object.values(fields).some((field) => !field.trim() || field.length > 350)
    )
      throw new Error(
        '리뷰 지적에 유효한 파일·줄·결함·영향·근거·수정 방향이 필요합니다.',
      );
  }
  return value;
}

export function validateDevelopment(value) {
  validate(value, developmentSchema, 'development');
  if (
    !value.summary.trim() ||
    value.summary.length > 1200 ||
    value.edits.length > 40
  )
    throw new Error(
      '개발 결과의 요약 또는 변경 수가 허용 범위를 벗어났습니다.',
    );
  if (
    value.status === 'completed' &&
    (value.title.length > 100 ||
      /[\r\n<>@\u202a-\u202e]/.test(value.title) ||
      !/^\p{Extended_Pictographic}.*? [^\n:]+: .*[가-힣]/u.test(value.title))
  )
    throw new Error(
      '개발 결과의 제목은 GitMoji와 한국어를 포함한 저장소 형식이어야 합니다.',
    );
  return value;
}

export function createModels({
  keys,
  modelNames,
  limits = config.limits,
  request = fetch,
  sleep = wait,
  log = console.log,
}) {
  function verify() {
    if (!keys.codex || !keys.claude)
      throw new Error(
        'OPENAI_API_KEY와 ANTHROPIC_API_KEY Actions Secrets를 모두 설정한 뒤 수동 재개하세요.',
      );
  }

  async function call(agent, body) {
    const isCodex = agent === 'codex';
    const name = agents[agent].name;
    const endpoint = isCodex
      ? 'https://api.openai.com/v1/responses'
      : 'https://api.anthropic.com/v1/messages';
    const headers = {
      'content-type': 'application/json',
      ...(isCodex
        ? { authorization: `Bearer ${keys[agent]}` }
        : { 'x-api-key': keys[agent], 'anthropic-version': '2023-06-01' }),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await request(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(limits.requestTimeout),
        });
      } catch {
        // The provider may already have processed a request with an unknown transport outcome.
        throw new Error(
          `${name} API 응답을 확인할 수 없습니다. 네트워크 및 사용량을 확인하세요.`,
        );
      }
      if (response.ok) return response.json();
      const status = response.status;
      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel();
      if (!attempt && (status === 429 || status === 503 || status === 529)) {
        const seconds = retryAfter === null ? 2 : Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 10) {
          await sleep(seconds * 1000);
          continue;
        }
      }
      throw Object.assign(
        new Error(
          `${name} API HTTP ${status}. Actions Secret, 모델 접근 권한 및 사용량 한도를 확인하세요.`,
        ),
        { requestRejected: [400, 401, 403, 404, 422, 429].includes(status) },
      );
    }
  }

  return {
    verify,
    async run({ agent, mode, instructions, context, inspect }) {
      const schema = mode === 'development' ? developmentSchema : reviewSchema;
      const verifyResult =
        mode === 'development' ? validateDevelopment : validateReview;
      const input = [{ role: 'user', content: context }];
      const isCodex = agent === 'codex';
      const model = modelNames[agent];
      for (let turn = 1; turn <= limits.turns; turn++) {
        const data = await call(
          agent,
          isCodex
            ? {
                model,
                instructions,
                input,
                store: false,
                include: ['reasoning.encrypted_content'],
                max_output_tokens: limits.outputTokens,
                reasoning: { effort: limits.codexEffort },
                text: {
                  format: {
                    type: 'json_schema',
                    name: mode,
                    schema,
                    strict: true,
                  },
                },
                tools: Object.entries(tools).map(
                  ([name, { description, input }]) => ({
                    type: 'function',
                    name,
                    description,
                    parameters: input,
                    strict: true,
                  }),
                ),
              }
            : {
                model,
                system: instructions,
                messages: input,
                max_tokens: limits.outputTokens,
                output_config: { format: { type: 'json_schema', schema } },
                tools: Object.entries(tools).map(
                  ([name, { description, input }]) => ({
                    name,
                    description,
                    input_schema: input,
                    strict: true,
                  }),
                ),
              },
        );
        const usage = Object.fromEntries(
          Object.entries(data.usage ?? {}).filter(
            ([, count]) => typeof count === 'number',
          ),
        );
        log(JSON.stringify({ agent, mode, model, turn, usage }));
        if (isCodex) {
          const output = data.output ?? [];
          if (data.status !== 'completed')
            throw new Error('Codex 응답이 완료되지 않았습니다.');
          const calls = output.filter(({ type }) => type === 'function_call');
          if (!calls.length) {
            const text = output
              .flatMap(({ content }) => content ?? [])
              .filter(({ type }) => type === 'output_text')
              .map(({ text }) => text)
              .join('');
            return verifyResult(parseJSON(text));
          }
          input.push(
            ...output,
            ...calls.map(({ name, arguments: args, call_id }) => ({
              type: 'function_call_output',
              call_id,
              output: invokeTool(inspect, name, parseJSON(args)),
            })),
          );
        } else {
          const output = data.content ?? [];
          if (data.stop_reason === 'tool_use') {
            input.push(
              { role: 'assistant', content: output },
              {
                role: 'user',
                content: output
                  .filter(({ type }) => type === 'tool_use')
                  .map(({ name, input: args, id }) => ({
                    type: 'tool_result',
                    tool_use_id: id,
                    content: invokeTool(inspect, name, args),
                  })),
              },
            );
          } else if (data.stop_reason === 'end_turn') {
            return verifyResult(
              parseJSON(
                output
                  .filter(({ type }) => type === 'text')
                  .map(({ text }) => text)
                  .join(''),
              ),
            );
          } else {
            throw new Error('Claude 응답이 완료되지 않았습니다.');
          }
        }
      }
      throw new Error(
        'AI의 저장소 탐색 최대 횟수에 도달했습니다. Issue 범위를 좁힌 뒤 수동 재개하세요.',
      );
    },
  };
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('AI가 유효한 JSON을 반환하지 않았습니다.');
  }
}

function invokeTool(inspect, name, input) {
  if (!Object.hasOwn(tools, name)) return 'Unknown tool.';
  try {
    validate(input, tools[name].input, 'tool');
    return inspect(name, input);
  } catch {
    return 'Invalid arguments or requested material is unavailable.';
  }
}
