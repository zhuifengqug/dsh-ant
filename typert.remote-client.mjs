/* Source-authored face for Tianshu Qunce; kept in sync with the Host face by tests. */
import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { createTypertSpec } from './src/host/typert-spec.mjs';

export const TYPERT_REMOTE = createTypertRemoteInfo(createTypertSpec(), z);
export default TYPERT_REMOTE;
