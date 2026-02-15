import { execSync } from 'node:child_process';
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';

const buildTime = process.env.BUILD_TIME ?? new Date().toISOString();
const repoRoot = process.cwd();

const resolveGitSha = (): string => {
  if (process.env.GIT_SHA && process.env.GIT_SHA.trim().length > 0) {
    return process.env.GIT_SHA.trim();
  }

  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
};

const gitSha = resolveGitSha();
const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';

@Controller('meta')
export class MetaController {
  @Get()
  @Public()
  getMeta() {
    return {
      app: 'zenops-v2',
      repo_root: repoRoot,
      git_sha: gitSha,
      build_time: buildTime,
      service: 'api',
      env
    };
  }
}
