export type ChannelProvider = 'evolution' | 'meta';

export function getChannelProvider(): ChannelProvider {
  const raw = (Deno.env.get('CHANNEL_PROVIDER') || 'evolution').toLowerCase();
  return raw === 'meta' ? 'meta' : 'evolution';
}

export function ignoredProviderResponse(expected: ChannelProvider) {
  return {
    ok: true,
    ignored: true,
    reason: `CHANNEL_PROVIDER!=${expected}`,
    current: getChannelProvider(),
  };
}
