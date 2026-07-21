import type { PartnerType } from './database.js';

export function getPartnerEntityLabel(partnerType: PartnerType | null | undefined) {
  return partnerType === 'influencer' ? 'influenciador' : 'assessoria';
}

export function getPartnerAuditEventTitle(action: string, partnerType: PartnerType | null | undefined) {
  const entity = getPartnerEntityLabel(partnerType);
  const titles: Record<string, string> = {
    'partner.link_accessed': `Link do ${entity} acessado`,
    'partner.link_rejected': `Link de ${entity} rejeitado`,
    'partner.resolution_approved': `${entity === 'influenciador' ? 'Influenciador' : 'Assessoria'} identificado(a)`,
    'partner.session_created': `Sessao do ${entity} criada`,
    'partner.session_replaced': `Sessao do ${entity} substituida`,
    'partner.session_replacement_blocked': `Substituicao do ${entity} bloqueada`,
    'registration.started': `Inscricao iniciada pelo ${entity}`,
    'registration.recovered': `Inscricao do ${entity} recuperada`,
    'partner.snapshot_persisted': `Snapshot do ${entity} persistido`,
    'discount.applied': `Desconto do ${entity} aplicado`,
    'payment.started': 'Pagamento iniciado',
    'webhook.received': 'Webhook de pagamento recebido',
    'payment.approved': 'Pagamento aprovado',
    'payment.declined': 'Pagamento recusado',
    'payment.amount_mismatch': 'Divergencia no valor do pagamento',
    'payment.duplicate_ignored': 'Evento duplicado ignorado',
    'payment.expired': 'Pagamento expirado',
    'payment.refunded': 'Pagamento reembolsado',
    'registration.cancelled': 'Inscricao cancelada',
    'consistency.issue_detected': `Inconsistencia de ${entity} detectada`,
    'partner.persistence_failed': `Falha ao persistir ${entity}`,
  };
  return titles[action] || action;
}
