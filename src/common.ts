import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { retry } from '@octokit/plugin-retry'
import { GitHub, Context } from './types'

export function getGitHub(): GitHub {
  const token: string = core.getInput('token', { required: true })
  return getOctokit(token, {}, retry)
}

export function getContext(): Context {
  return context
}

export async function removeClosedReasonLabels(github: GitHub, ctx: Context, itemNumber: number, labels: string[]): Promise<void> {
  const staleLabels = labels.filter((label: string) => label.startsWith('closed:') || label === 'pending:closed-reason')
  for (const label of staleLabels) {
    await github.rest.issues.removeLabel({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      issue_number: itemNumber,
      name: label
    })
  }
}
