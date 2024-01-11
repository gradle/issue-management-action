import { Context as Ctx } from '@actions/github/lib/context'
import { GitHub } from '@actions/github/lib/utils'
import { RequestParameters as ORP } from '@octokit/types'

export type Context = Ctx
export type GitHub = InstanceType<typeof GitHub>
export type RequestParameters = ORP
