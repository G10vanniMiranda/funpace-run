export type AdminOperationExistingRecord = {
  actor: string | null;
  at: string | null;
};

export type BibAssignmentGuardInput = {
  registrationStatus: string;
  eventStatus: string | null;
  lotStatus: string | null;
  currentBibNumber: string | null;
  nextBibNumber: string;
  isBibTaken: boolean;
};

export function getCheckInConflictMessage(existing: AdminOperationExistingRecord) {
  return `Check-in ja registrado${existing.actor ? ` por ${existing.actor}` : ''}${existing.at ? ` em ${existing.at}` : ''}.`;
}

export function getKitConflictMessage(existing: AdminOperationExistingRecord) {
  return `Kit ja entregue${existing.actor ? ` por ${existing.actor}` : ''}${existing.at ? ` em ${existing.at}` : ''}.`;
}

export function canUndoCheckIn(hasCheckIn: boolean) {
  return hasCheckIn ? null : 'Nao existe check-in registrado para desfazer.';
}

export function canUndoKit(hasKitDelivery: boolean) {
  return hasKitDelivery ? null : 'Nao existe entrega de kit registrada para desfazer.';
}

export function validateBibAssignment(input: BibAssignmentGuardInput) {
  if (!['pending_payment', 'paid'].includes(input.registrationStatus)) {
    return 'Nao e permitido alterar numero de peito para inscricoes encerradas.';
  }

  if (input.eventStatus === 'closed' || input.lotStatus === 'closed') {
    return 'Nao e permitido alterar numero de peito com evento ou lote encerrado.';
  }

  if (input.currentBibNumber === input.nextBibNumber) {
    return 'Este numero de peito ja esta atribuido para a inscricao.';
  }

  if (input.isBibTaken) {
    return 'Numero de peito ja utilizado neste evento.';
  }

  return null;
}
