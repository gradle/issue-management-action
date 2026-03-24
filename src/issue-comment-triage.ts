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
             state, stateReason, closedAt
             milestone { title }
             labels(first: 100) {
               nodes { name }
             }
             timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) {
               nodes {
                 ... on ClosedEvent {
                   actor { login }
                 }
               }
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
    const commentCreatedAt = new Date(context.payload.comment!.created_at)
    const issueClosedAt = new Date(issue.closedAt)
    if (commentCreatedAt <= issueClosedAt) {
      console.log('Skipping: the comment was created before the issue was closed')
      return
    }
    const commenter = context.payload.comment!.user!.login
    const closedByNodes = issue.timelineItems.nodes
    const closer = closedByNodes.length > 0 ? closedByNodes[0].actor?.login : null
    if (commenter === closer) {
      console.log(`Skipping: the comment was made by the same person who closed the issue (${commenter})`)
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
