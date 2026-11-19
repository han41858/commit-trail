import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NeedsHuman } from './engine.mjs';

const maxBuffer = 8 * 1024 * 1024;
const maxFileBytes = 1024 * 1024;
const regularModes = new Set(['100644', '100755']);
const protectedNames = /^(?:\.git|node_modules)$/i;
const environmentFile = /^\.env(?:\.|$)/i;
const environmentExample = /^\.env\.example$/i;
const shaPattern = /^[a-f0-9]{40}$/;

function outputPage(text, start, span) {
  const lines = text.split('\n');
  const offset = Math.max(0, start - 1);
  const result = lines
    .slice(offset, offset + span)
    .map((line, index) => `${offset + index + 1}: ${line.slice(0, 1500)}`);
  // The next page offset describes the lines actually served, including long minified lines.
  while (result.join('\n').length > 5500) result.pop();
  if (offset + result.length < lines.length)
    result.push(`Next line: ${offset + result.length + 1}`);
  return result.join('\n');
}

function isEditable(path) {
  return (
    path.length <= 250 &&
    path
      .split('/')
      .every(
        (part) =>
          /^[\p{L}\p{N}_.-]+$/u.test(part) &&
          part !== '.' &&
          part !== '..' &&
          !protectedNames.test(part) &&
          (!environmentFile.test(part) || environmentExample.test(part)),
      )
  );
}

export function resolveEdits(edits, { files, read }) {
  const updated = new Map();
  for (const { path, before, after } of edits) {
    if (!isEditable(path))
      throw new NeedsHuman(
        '저장소 밖 경로, Git 내부 데이터, 의존성 설치 폴더 또는 비밀 파일을 편집하려 했습니다. 수동 검토가 필요합니다.',
      );
    const mode = files.get(path);
    const ancestors = path.split('/').slice(0, -1);
    if (
      (mode && mode !== '100644') ||
      ancestors.some((_, i) =>
        files.has(ancestors.slice(0, i + 1).join('/')),
      ) ||
      [...files.keys()].some((file) => file.startsWith(`${path}/`))
    ) {
      throw new NeedsHuman(
        '일반 파일 이외의 경로 또는 기존 폴더를 변경하려 했습니다. 수동 검토가 필요합니다.',
      );
    }
    const current = updated.has(path)
      ? updated.get(path)
      : mode
        ? read(path)
        : null;
    if (before === null) {
      if (current !== null || after === null)
        throw new Error(
          '새 파일 편집이 기존 파일 또는 다른 편집과 충돌했습니다.',
        );
      updated.set(path, after);
    } else if (after === null) {
      if (current !== before)
        throw new Error(
          '삭제할 파일 내용이 최신 HEAD와 정확히 일치하지 않습니다.',
        );
      updated.set(path, null);
    } else {
      const first = current?.indexOf(before) ?? -1;
      if (!before || first < 0 || current.indexOf(before, first + 1) !== -1)
        throw new Error(
          '편집 위치의 원문이 없거나 여러 곳에 있습니다. 위치를 식별할 수 있는 원문이 필요합니다.',
        );
      updated.set(
        path,
        current.slice(0, first) + after + current.slice(first + before.length),
      );
    }
    const content = updated.get(path);
    if (
      content !== null &&
      (content.includes('\0') || Buffer.byteLength(content) > maxFileBytes)
    )
      throw new NeedsHuman(
        '편집 결과가 일반 텍스트 파일의 크기 제한을 벗어났습니다.',
      );
  }
  const changes = [...updated].filter(
    ([path, value]) => value !== (files.has(path) ? read(path) : null),
  );
  const finalFiles = new Set(files.keys());
  for (const [path, value] of changes) {
    if (value === null) finalFiles.delete(path);
    else finalFiles.add(path);
  }
  for (const path of finalFiles) {
    const pieces = path.split('/');
    if (
      pieces
        .slice(0, -1)
        .some((_, i) => finalFiles.has(pieces.slice(0, i + 1).join('/')))
    )
      throw new NeedsHuman(
        '여러 편집이 같은 파일과 폴더 경로를 사용합니다. 수동으로 검토하세요.',
      );
  }
  return changes.map(([path, text]) => ({ path, text }));
}

export function createWorkspace({
  config,
  repository,
  token,
  cwd = process.cwd(),
  spawn = spawnSync,
}) {
  const scratch = mkdtempSync(
    join(process.env.RUNNER_TEMP || tmpdir(), 'commit-trail-ai-'),
  );
  const image = `commit-trail-ai:${randomUUID()}`;
  let cachedDependencies;
  const git = (args, options = {}) =>
    execFileSync('git', args, {
      cwd,
      maxBuffer,
      timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
  const gitText = (...args) => git(args).toString('utf8');

  function ensureCommit(sha) {
    if (!shaPattern.test(sha)) throw new Error('유효한 커밋 SHA가 필요합니다.');
    try {
      git(['cat-file', '-e', `${sha}^{commit}`]);
    } catch {
      try {
        git(
          ['fetch', '--no-tags', `https://github.com/${repository}.git`, sha],
          {
            env: {
              ...process.env,
              GIT_CONFIG_COUNT: '1',
              GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
              GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
              GIT_TERMINAL_PROMPT: '0',
            },
          },
        );
      } catch {
        throw new Error(
          '검증할 커밋을 Git에서 가져올 수 없습니다. 저장소 읽기 권한을 확인하세요.',
        );
      }
    }
  }

  function snapshot(state) {
    ensureCommit(state.base);
    ensureCommit(state.head);
    const files = new Map(
      gitText('ls-tree', '-r', '-z', state.head)
        .split('\0')
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf('\t');
          return [line.slice(separator + 1), line.slice(0, 6)];
        }),
    );
    function read(path) {
      if (!regularModes.has(files.get(path)))
        throw new Error('Only tracked regular files can be read.');
      const bytes = git(['show', `${state.head}:${path}`]);
      if (bytes.length > maxFileBytes || bytes.includes(0))
        throw new Error('Only bounded UTF-8 text can be read.');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    }
    let diff;
    return {
      files,
      read,
      instructions: gitText('show', `${state.base}:${config.instructions}`),
      inspect(name, input) {
        if (name === 'list_files') {
          const matching = [...files.keys()].filter((path) =>
            path.toLowerCase().includes(input.query.toLowerCase()),
          );
          const offset = Math.max(0, input.offset);
          const paths = matching.slice(offset, offset + 65);
          paths.push(
            `${matching.length} total. ${offset + 65 < matching.length ? `Next offset: ${offset + 65}` : 'End of paths.'}`,
          );
          return paths.join('\n');
        }
        if (name === 'read_file')
          return outputPage(read(input.path), input.line, 150);
        diff ??= gitText(
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          state.base,
          state.head,
          '--',
        );
        return outputPage(diff, input.line, 120);
      },
    };
  }

  function prepareDependencies(source) {
    const manifests = new Map();
    try {
      for (const name of ['package.json', 'package-lock.json']) {
        const path = join(source, name);
        if (!lstatSync(path).isFile())
          throw new Error('Dependency manifests must be regular files.');
        manifests.set(name, readFileSync(path));
      }
    } catch {
      return {
        ok: false,
        step: '의존성 파일 확인',
        log: '수정 후 package.json과 package-lock.json이 일반 파일로 존재해야 합니다.',
      };
    }
    const digest = createHash('sha256');
    for (const [name, bytes] of manifests)
      digest.update(name).update('\0').update(bytes).update('\0');
    const key = digest.digest('hex');
    if (cachedDependencies === key) return { ok: true };
    const context = join(scratch, 'dependencies');
    mkdirSync(context, { recursive: true });
    for (const [name, bytes] of manifests)
      writeFileSync(join(context, name), bytes);
    writeFileSync(
      join(context, 'Dockerfile'),
      [
        'FROM node:24-bookworm',
        'WORKDIR /dependencies',
        'COPY package.json package-lock.json ./',
        'RUN --mount=type=secret,id=npm_ca if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci --ignore-scripts --no-audit --no-fund',
        'USER node',
        '',
      ].join('\n'),
    );
    const build = ['build', '--tag', image];
    if (process.env.NODE_EXTRA_CA_CERTS)
      build.push(
        '--secret',
        `id=npm_ca,src=${process.env.NODE_EXTRA_CA_CERTS}`,
      );
    const result = spawn('docker', [...build, context], {
      timeout: 240_000,
      maxBuffer,
    });
    if (result.error || result.status === 125)
      throw new Error(
        'Docker 의존성 설치를 실행하지 못했습니다. 실행 환경과 연결을 확인하세요.',
      );
    if (result.status !== 0)
      return {
        ok: false,
        step: '의존성 설치',
        log: `수정 후 의존성 설치가 실패했습니다. package.json과 package-lock.json의 일치를 확인하세요.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(
          -6500,
        ),
      };
    cachedDependencies = key;
    return { ok: true };
  }

  function runChecks(state, changes) {
    const source = mkdtempSync(join(scratch, 'source-'));
    chmodSync(source, 0o755);
    const container = `commit-trail-ai-${randomUUID()}`;
    try {
      try {
        // git archive produces symlinks as symlinks. Model writes only touch audited regular paths.
        execFileSync('tar', ['-xf', '-', '-C', source], {
          input: git(['archive', state.head]),
          maxBuffer,
        });
      } catch {
        throw new Error('검증할 Git 스냅샷을 준비할 수 없습니다.');
      }
      for (const { path, text } of changes) {
        const file = join(source, path);
        if (text === null) rmSync(file);
        else {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
        }
      }
      const dependencies = prepareDependencies(source);
      if (!dependencies.ok) return dependencies;
      const checkMarker = `${container}:check:`;
      const script = [
        'mkdir /tmp/project',
        'cp -a --no-preserve=ownership /source/. /tmp/project/',
        'cd /tmp/project',
        'cp -a --no-preserve=ownership /dependencies/node_modules ./node_modules',
        ...config.checks.flatMap((command, index) => [
          `printf '%s\\n' '${checkMarker}${index}'`,
          command,
        ]),
      ].join('\n');
      const result = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          container,
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--pids-limit',
          '192',
          '--memory',
          '2048m',
          '--tmpfs',
          '/tmp:rw,exec,nosuid,nodev,size=1g,mode=1777',
          '--mount',
          `type=bind,src=${source},dst=/source,readonly`,
          '--env',
          'npm_config_cache=/tmp/npm-cache',
          '--env',
          `GITHUB_BASE_REF=${config.base}`,
          image,
          'bash',
          '-euc',
          script,
        ],
        { timeout: 300_000, encoding: 'utf8', maxBuffer },
      );
      if (result.error || result.status === 125)
        throw new Error(
          '격리 테스트를 끝낼 수 없습니다. Docker 실행 환경과 제한 시간을 확인하세요.',
        );
      const lastCheck = result.stdout
        ?.split('\n')
        .findLast((line) => line.startsWith(checkMarker));
      const index = lastCheck
        ? Number(lastCheck.slice(checkMarker.length))
        : -1;
      return {
        ok: result.status === 0,
        ...(result.status !== 0 && {
          step: config.checks[index] ?? '격리 검사 준비',
        }),
        log: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-6500),
      };
    } finally {
      spawn('docker', ['container', 'rm', '--force', container], {
        timeout: 10_000,
        stdio: 'ignore',
      });
      rmSync(source, { recursive: true, force: true });
    }
  }

  return {
    snapshot,
    runChecks,
    close() {
      if (cachedDependencies)
        spawn('docker', ['image', 'rm', image], {
          timeout: 10_000,
          stdio: 'ignore',
        });
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}
