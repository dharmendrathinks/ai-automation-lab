import { startStack } from './support/stack.js';

export default async function globalSetup() {
  const stack = await startStack();
  process.env.RELAYDESK_E2E_BASE_URL = stack.baseURL;
  process.env.RELAYDESK_E2E_INSTANCE = stack.instance;
  return stack.stop;
}
