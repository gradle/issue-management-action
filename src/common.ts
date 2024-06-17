import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { retry } from '@octokit/plugin-retry'
import { GitHub, Context } from './types'

export function getGitHub(): GitHub {
  const token: string = core.getInput('token', { required: true })
  return getOctokit(token, retry)
}

export function getContext(): Context {
  return context
}
