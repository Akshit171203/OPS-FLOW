import { config } from '../../lib/config';
import { FakeProvider } from './fake';
import { GeminiProvider } from './gemini';
import { UnconfiguredProvider, type AIProvider } from './provider';

let provider: AIProvider | undefined;

/**
 * The configured provider, created lazily. Only the AI worker and the runbook indexer call this,
 * so with no API key the rest of the application never touches it.
 */
export function getAIProvider(): AIProvider {
  if (provider) return provider;
  if (config.AI_PROVIDER === 'gemini') {
    provider = config.GEMINI_API_KEY
      ? new GeminiProvider({ apiKey: config.GEMINI_API_KEY })
      : new UnconfiguredProvider('AI_PROVIDER is "gemini" but GEMINI_API_KEY is not set');
  } else {
    provider = new FakeProvider();
  }
  return provider;
}

/** Test hook: replace (or reset with undefined) the process-wide provider. */
export function setAIProvider(next: AIProvider | undefined) {
  provider = next;
}
