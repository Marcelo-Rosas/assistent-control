export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/** remoteJid like 5511999999999@s.whatsapp.net or ...@lid */
export function normalizeWhatsAppJid(remoteJid: string): { external_id: string; phone: string } {
  const external_id = remoteJid.trim();
  const userPart = external_id.split('@')[0] || '';
  const phone = digitsOnly(userPart);
  return { external_id, phone };
}
