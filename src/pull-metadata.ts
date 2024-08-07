import * as core from '@actions/core'
import * as common from './common'
import { GitHub, Context } from './types'

const pendingMilestoneLabel = 'pending:milestone'

export async function run(github: GitHub, context: Context): Promise<void> {
  try {
    const prNumber: number = context.payload.pull_request!.number // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const response: any = await github.graphql(
      `query($owner:String!, $name:String!, $pr: Int!) {
         repository(owner:$owner, name:$name){
           pullRequest(number: $pr) {
             state
             baseRefName
             milestone { title }
             labels(first: 100) {
               nodes { name }
             }
           }
         }
       }`,
      {
        owner: context.repo.owner,
        name: context.repo.repo,
        pr: prNumber
      }
    )

    const pr = response.repository.pullRequest
    const labels = pr.labels.nodes.map((label: any) => label.name)

    if (pr.state === 'MERGED' && (pr.baseRefName === 'master' || pr.baseRefName === 'main' || pr.baseRefName.startsWith('release'))) {
      if (pr.milestone === null) {
        await github.rest.issues.addLabels({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: prNumber,
          labels: ['to-triage', pendingMilestoneLabel]
        })
      } else if (labels.includes(pendingMilestoneLabel)) {
        await github.rest.issues.removeLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: prNumber,
          name: pendingMilestoneLabel
        })
      }
    } else if (pr.state === 'CLOSED' && pr.milestone !== null) {
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        milestone: null
      })
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
    throw error
  }
}

run(common.getGitHub(), common.getContext())
