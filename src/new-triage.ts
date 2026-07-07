import * as core from '@actions/core'
import * as common from './common'
import { GitHub, Context } from './types'

const maintainerPermissions = ['write', 'maintain', 'admin']

export async function run(github: GitHub, context: Context): Promise<void> {
  try {
    if (context.payload.repository?.fork) {
      console.log('Skipping: the event was triggered on a fork, not the original repository')
      return
    }

    const isPullRequest = context.payload.pull_request != null
    const item = context.payload.pull_request ?? context.payload.issue
    if (item == null) {
      console.log('Skipping: the event was not triggered for an issue or a pull request')
      return
    }
    const number: number = item.number
    const author: string = item.user!.login // eslint-disable-line @typescript-eslint/no-non-null-assertion

    if (author === 'dependabot[bot]') {
      console.log(`Skipping: #${number} was authored by Dependabot`)
      return
    }

    const permissionResponse = await github.rest.repos.getCollaboratorPermissionLevel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      username: author
    })
    if (maintainerPermissions.includes(permissionResponse.data.permission)) {
      console.log(`Skipping: the author (${author}) is a repo maintainer (${permissionResponse.data.permission})`)
      return
    }

    const labelsToAdd = isPullRequest ? ['to-triage', 'from:contributor'] : ['to-triage']
    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: number,
      labels: labelsToAdd
    })

    console.log(`Added labels [${labelsToAdd.join(', ')}] to #${number} from external contributor ${author}`)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    throw error
  }
}

run(common.getGitHub(), common.getContext())
