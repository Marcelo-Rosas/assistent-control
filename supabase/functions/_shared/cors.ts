export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-rag-include-debug',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}
