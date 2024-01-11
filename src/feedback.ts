import * as core from '@actions/core'
import * as config from './feedback-config'
import { GitHub, Context, RequestParameters } from './types'

const issuesQuery = `query($owner:String!, $name:String!, $labels: [String!]) {
    repository(owner:$owner, name:$name){
      issues(last:100, labels: $labels){
        nodes {
          id, number, updatedAt
          labels(first: 100) {
            nodes { id, name }
          }
          timelineItems(last: 100, itemTypes: [LABELED_EVENT, CLOSED_EVENT, ISSUE_COMMENT, RENAMED_TITLE_EVENT]) {
            nodes {
              __typename
              ... on LabeledEvent {
                createdAt
                label {
                  name
                }
              }
            }
          }
        }
      }
    }
}`

const pullsQuery = `query($owner:String!, $name:String!, $labels: [String!]) {
    repository(owner:$owner, name:$name){
      pullRequests(last:100, labels: $labels){
        nodes {
          id, number, updatedAt
          labels(first: 100) {
            nodes { id, name }
          }
          timelineItems(last: 100, itemTypes: [
            LABELED_EVENT, BASE_REF_CHANGED_EVENT, CLOSED_EVENT, ISSUE_COMMENT, RENAMED_TITLE_EVENT,
            PULL_REQUEST_COMMIT, PULL_REQUEST_COMMIT_COMMENT_THREAD, PULL_REQUEST_REVIEW_THREAD,
            PULL_REQUEST_REVIEW, PULL_REQUEST_REVISION_MARKER, READY_FOR_REVIEW_EVENT, REVIEW_REQUESTED_EVENT
          ]) {
            nodes {
              __typename
              ... on LabeledEvent {
                createdAt
                label {
                  name
                }
              }
            }
          }
        }
      }
    }
}`

const commentMutationPart = `
  addComment(input: {subjectId: $itemId, body: $body}) {
    clientMutationId
  }
`

const addLabelsMutationPart = `
  addLabelsToLabelable(input: {labelableId: $itemId, labelIds: [$closeLabelId]}){
    clientMutationId
  }
`

const removeLabelsMutationPart = `
  removeLabelsFromLabelable(input: {labelableId: $itemId, labelIds: $labelIds}){
    clientMutationId
  }
`

const closeIssueMutation = `mutation ($itemId: ID!, $body: String!, $labelIds: [ID!]!, $closeLabelId: ID!) {
  ${commentMutationPart}
  closeIssue(input: {issueId: $itemId, stateReason: NOT_PLANNED}) {
    clientMutationId
  }
  ${addLabelsMutationPart}
  ${removeLabelsMutationPart}
}`

const closePullMutation = `mutation ($itemId: ID!, $body: String!, $labelIds: [ID!]!, $closeLabelId: ID!) {
  ${commentMutationPart}
  closePullRequest(input: {pullRequestId: $itemId}) {
    clientMutationId
  }
  ${addLabelsMutationPart}
  ${removeLabelsMutationPart}
}`

const removeLabelsMutation = `mutation ($itemId: ID!, $labelIds: [ID!]!) {
   ${removeLabelsMutationPart}
 }`

function queryParams(
  context: Context,
  feedbackLabels: config.FeedbackLabels
): RequestParameters {
  return {
    owner: context.repo.owner,
    name: context.repo.repo,
    labels: Array.from(feedbackLabels.keys())
  }
}

function wasUpdatedAfterLabeling(events: Array<any>): boolean {
  var hasUpdateEvent = false
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].__typename != 'LabeledEvent') {
      hasUpdateEvent = true
    } else if (events[i].label.name.startsWith('pending:')) {
      break
    }
  }
  return hasUpdateEvent
}

async function process(
  github: GitHub,
  closedLabelsIds: Map<String, String>,
  item: any,
  cutoff: Date,
  feedbackLabels: config.FeedbackLabels,
  closeMutation: string
): Promise<void> {
  if (wasUpdatedAfterLabeling(item.timelineItems.nodes)) {
    await github.graphql(removeLabelsMutation, {
      itemId: item.id,
      labelIds: item.labels.nodes
        .filter((label: any) => feedbackLabels.has(label.name))
        .map((label: any) => label.id)
    })

    console.log(
      `Removed labels on ${item.number} because it was updated after labeled.`
    )
  } else if (new Date(item.updatedAt) < cutoff) {
    const mainLabel = item.labels.nodes.find((label: any) =>
      feedbackLabels.has(label.name)
    )

    await github.graphql(closeMutation, {
      itemId: item.id,
      body: feedbackLabels.get(mainLabel.name)!.message,
      labelIds: item.labels.nodes
        .filter(
          (label: any) =>
            feedbackLabels.has(label.name) ||
            config.labelsToRemoveOnClose.has(label.name)
        )
        .map((label: any) => label.id),
      closeLabelId: closedLabelsIds.get(
        feedbackLabels.get(mainLabel.name)!.closeLabel
      )
    })

    console.log(
      `Closed ${item.number} because it was last updated on ${item.updatedAt} and had the label ${mainLabel.name}.`
    )
  }
  console.log(
    `Skipping ${item.number} because it was last updated on ${item.updatedAt} and ${cutoff}.`
  )
}

async function getAllClosedLabelIds(
  github: GitHub,
  context: Context
): Promise<Map<String, String>> {
  const response: any = await github.graphql(`query{
      repository(owner: "${context.repo.owner}", name: "${context.repo.repo}"){
        labels(first: 100, query: "closed:") {
          nodes {
            id, name
          }
        }
      }
    }`)
  return new Map(
    response.repository.labels.nodes.map((label: any) => [label.name, label.id])
  )
}

function daysAgo(days: number): Date {
  const result = new Date()
  result.setDate(result.getDate() - days)
  return result
}

export async function run(github: GitHub, context: Context): Promise<void> {
  try {
    const closedLabelsIds = await getAllClosedLabelIds(github, context)

    const issuesResult: any = await github.graphql(
      issuesQuery,
      queryParams(context, config.issueLabels)
    )
    issuesResult.repository.issues.nodes.forEach((issue: any) =>
      process(
        github,
        closedLabelsIds,
        issue,
        daysAgo(config.issuesCutoff),
        config.issueLabels,
        closeIssueMutation
      )
    )

    const pullsResult: any = await github.graphql(
      pullsQuery,
      queryParams(context, config.pullsLabels)
    )
    pullsResult.repository.pullRequests.nodes.forEach((pullRequest: any) =>
      process(
        github,
        closedLabelsIds,
        pullRequest,
        daysAgo(config.pullsCutoff),
        config.pullsLabels,
        closePullMutation
      )
    )
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
