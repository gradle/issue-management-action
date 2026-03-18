import * as core from '@actions/core'
import * as common from './common'
import { GitHub, Context } from './types'

export async function run(github: GitHub, context: Context): Promise<void> {
  try {
    if (context.payload.issue?.pull_request) {
      console.log('Skipping: the event was triggered for a pull request')
      return
    }
    const issueNumber: number = context.payload.issue!.number // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const response: any = await github.graphql(
      `query($owner:String!, $name:String!, $issue: Int!) {
         repository(owner:$owner, name:$name){
           issue(number: $issue) {
             state, stateReason
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
        issue: issueNumber
      }
    )

    const issue = response.repository.issue
    const labels = issue.labels.nodes.map((label: any) => label.name)
    if (issue.state !== 'CLOSED') {
      console.log('Skipping: the issue is not closed')
      return
    }
    if (labels.includes('to-triage')) {
      console.log('Skipping: the issue already has the to-triage label')
      return
    }

    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      labels: ['to-triage']
    })

    console.log(`Added to-triage label to closed issue #${issueNumber}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
    throw error
  }
}

run(common.getGitHub(), common.getContext())
