import * as core from '@actions/core'
import * as common from './common'
import { GitHub, Context } from './types'

export async function run(github: GitHub, context: Context): Promise<void> {
  try {
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

    var needsUpdate = false
    if (issue.state === 'OPEN') {
      needsUpdate = !(
        labels.some((label: string) => label.startsWith('in:')) &&
        labels.filter((label: string) => label.startsWith('a:')).length === 1 &&
        !labels.includes('to-triage')
      )
    } else if (issue.state === 'CLOSED') {
      if (issue.stateReason === 'NOT_PLANNED') {
        needsUpdate = !labels.some((label: string) => label.startsWith('closed:'))
        if (labels.includes('pending:milestone')) {
          await github.rest.issues.removeLabel({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            name: 'pending:milestone'
          })
        }
      } else if (issue.stateReason === 'COMPLETED') {
        if (issue.milestone === null) {
          needsUpdate = true
          await github.rest.issues.addLabels({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            labels: ['pending:milestone']
          })
        }
      }
    }

    if (needsUpdate) {
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        labels: ['to-triage']
      })
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
    throw error
  }
}

run(common.getGitHub(), common.getContext())
