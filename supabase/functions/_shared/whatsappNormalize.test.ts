import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { digitsOnly, normalizeWhatsAppJid } from './whatsappNormalize.ts';

Deno.test('normalize jid', () => {
  const r = normalizeWhatsAppJid('5511987654321@s.whatsapp.net');
  assertEquals(r.phone, '5511987654321');
  assertEquals(r.external_id, '5511987654321@s.whatsapp.net');
});

Deno.test('normalize lid jid strips non-digits from user part', () => {
  const r = normalizeWhatsAppJid('  5511-9876-54321@lid  ');
  assertEquals(r.external_id, '5511-9876-54321@lid');
  assertEquals(r.phone, '5511987654321');
});

Deno.test('digitsOnly strips everything but digits', () => {
  assertEquals(digitsOnly('+55 (11) 98765-4321'), '5511987654321');
});
