/* Source-authored face for Amber Ant; no generator output is claimed. */
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';
import { createTypertSpec } from './src/host/typert-spec.mjs';

const $remote = createTypertRemoteInfo(createTypertSpec(), z);

export const TYPERT = {
  package: $remote.package,
  face: 'host',
  schemas: [],
  get invocations() { return $remote.descriptors; },
  model: {
    services: [{
      key: 'ant',
      types: [],
      exportName: 'AntService',
      description: 'Host service backing the Amber Ant Team namespace.',
      summary: 'Host service backing the Amber Ant Team namespace.',
      tags: [],
      members: [
        { kind: 'method', name: 'dispatch', signature: 'dispatch(request: TeamDispatchRequest, signal: AbortSignal): Promise<TeamDispatchReceipt>' },
        { kind: 'method', name: 'get', signature: 'get(request: TeamGetRequest, signal: AbortSignal): Promise<TeamView>' },
        { kind: 'method', name: 'list', signature: 'list(request: TeamListRequest, signal: AbortSignal): Promise<TeamListResult>' },
      ],
    }],
    events: [],
    objects: [],
  },
};

export { $remote };
export default TYPERT;
