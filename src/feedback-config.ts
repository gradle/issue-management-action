export type FeedbackLabels = Map<
  String,
  { closeLabel: string; message: string }
>

export const labelsToRemoveOnClose = new Set([
  'to-triage',
  ':wave: team-triage'
])

export const issuesCutoff = 7
export const issueLabels: FeedbackLabels = new Map([
  [
    'pending:reproducer',
    {
      closeLabel: 'closed:unreproducible',
      message:
        'While we asked for a reproducer, none was provided. If you provide a valid reproducer, we will consider this issue again. In the meantime, closing as unreproducible.'
    }
  ],
  [
    'pending:feedback',
    {
      closeLabel: 'closed:missing-feedback',
      message:
        'While we asked for feedback, none was provided. If you provide the requested feedback, we will consider this issue again. In the meantime, closing as missing feedback.'
    }
  ]
])

export const pullsCutoff = 14
export const pullsLabels: FeedbackLabels = new Map([
  [
    'pending:dco',
    {
      closeLabel: 'closed:missing-dco',
      message:
        'While we asked to sign your commits, it has not been done. If you sign your commits, we will consider this pull request again. In the meantime, closing as missing DCO (see the [Developer Certificate of Origin](https://probot.github.io/apps/dco/) GitHub app).'
    }
  ],
  [
    'pending:feedback',
    {
      closeLabel: 'closed:missing-feedback',
      message:
        'While we asked for changes to this PR, we received no reaction. If you provide the requested changes, we will consider this pull request again. In the meantime, closing as missing PR feedback.'
    }
  ]
])
