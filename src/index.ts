/**
 * The entrypoint for the action.
 */
import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { retry } from '@octokit/plugin-retry'
import * as feedback from './feedback'
import * as issue_metadata from './issue-metadata'
import * as pull_metadata from './pull-metadata'

const script: string = core.getInput('script')
const token: string = core.getInput('token', { required: true })
const github = getOctokit(token, retry)

switch (script) {
  case 'feedback': {
    feedback.run(github, context)
    break
  }
  case 'issue-metadata': {
    issue_metadata.run(github, context)
    break
  }
  case 'pull-metadata': {
    pull_metadata.run(github, context)
    break
  }
  default: {
    throw new Error(`Unknown script: ${script}`)
  }
}
