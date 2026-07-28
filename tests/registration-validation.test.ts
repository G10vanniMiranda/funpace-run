import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRegistration } from '../src/lib/validation';
import type { RegistrationFormData } from '../src/types/registration';

const validRegistration: RegistrationFormData = {
  fullName: 'Atleta Exemplo',
  email: 'atleta@example.com',
  cpf: '529.982.247-25',
  phone: '(69) 99999-9999',
  city: 'Porto Velho',
  state: 'RO',
  team: '',
  birthDate: '1990-01-01',
  gender: 'female',
  shirtSize: 'M',
  distance: '5K',
  emergencyContactName: '',
  emergencyContactPhone: '',
  termsAccepted: false,
  regulationAccepted: true,
  privacyAccepted: false,
};

test('exige o aceite do regulamento para concluir a inscrição', () => {
  const errors = validateRegistration({
    ...validRegistration,
    regulationAccepted: false,
  });

  assert.equal(errors.regulationAccepted, 'Leia e aceite o regulamento para continuar.');
});

test('aceita a inscrição válida quando o regulamento foi aceito', () => {
  assert.deepEqual(validateRegistration(validRegistration), {});
});
