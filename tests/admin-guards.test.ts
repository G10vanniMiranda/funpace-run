import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUndoCheckIn,
  canUndoKit,
  getCheckInConflictMessage,
  getKitConflictMessage,
  validateBibAssignment,
} from '../server/admin-guards.js';

test('formats check-in conflict message with actor and time', () => {
  assert.equal(
    getCheckInConflictMessage({ actor: 'operador', at: '2026-07-07T10:00:00.000Z' }),
    'Check-in ja registrado por operador em 2026-07-07T10:00:00.000Z.',
  );
});

test('formats kit conflict message without optional fields', () => {
  assert.equal(
    getKitConflictMessage({ actor: null, at: null }),
    'Kit ja entregue.',
  );
});

test('blocks undo check-in when no check-in exists', () => {
  assert.equal(canUndoCheckIn(false), 'Nao existe check-in registrado para desfazer.');
  assert.equal(canUndoCheckIn(true), null);
});

test('blocks undo kit when no delivery exists', () => {
  assert.equal(canUndoKit(false), 'Nao existe entrega de kit registrada para desfazer.');
  assert.equal(canUndoKit(true), null);
});

test('blocks bib assignment for closed registrations', () => {
  assert.equal(validateBibAssignment({
    registrationStatus: 'cancelled',
    eventStatus: 'published',
    lotStatus: 'active',
    currentBibNumber: null,
    nextBibNumber: 'A-10',
    isBibTaken: false,
  }), 'Nao e permitido alterar numero de peito para inscricoes encerradas.');
});

test('blocks bib assignment for closed event or lot', () => {
  assert.equal(validateBibAssignment({
    registrationStatus: 'paid',
    eventStatus: 'closed',
    lotStatus: 'active',
    currentBibNumber: null,
    nextBibNumber: 'A-10',
    isBibTaken: false,
  }), 'Nao e permitido alterar numero de peito com evento ou lote encerrado.');
});

test('blocks bib reassignment when same number is already set', () => {
  assert.equal(validateBibAssignment({
    registrationStatus: 'paid',
    eventStatus: 'published',
    lotStatus: 'active',
    currentBibNumber: 'A-10',
    nextBibNumber: 'A-10',
    isBibTaken: false,
  }), 'Este numero de peito ja esta atribuido para a inscricao.');
});

test('blocks bib assignment when number is already taken in event', () => {
  assert.equal(validateBibAssignment({
    registrationStatus: 'paid',
    eventStatus: 'published',
    lotStatus: 'active',
    currentBibNumber: null,
    nextBibNumber: 'A-10',
    isBibTaken: true,
  }), 'Numero de peito ja utilizado neste evento.');
});

test('allows valid bib assignment', () => {
  assert.equal(validateBibAssignment({
    registrationStatus: 'paid',
    eventStatus: 'published',
    lotStatus: 'active',
    currentBibNumber: null,
    nextBibNumber: 'A-10',
    isBibTaken: false,
  }), null);
});
