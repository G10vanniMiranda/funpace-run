import type { RegistrationErrors, RegistrationFormData } from '../types/registration';

const allowedDistances = new Set(['10K', '5K']);
const allowedShirtSizes = new Set(['P', 'M', 'G', 'GG']);
const allowedGenders = new Set(['female', 'male']);
export const requireRegistrationAcceptances = false;

export function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

export function formatCpf(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11);

  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }

  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

function isValidCpf(cpf: string) {
  const digits = onlyDigits(cpf);

  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) {
    return false;
  }

  const calculateDigit = (factor: number) => {
    let total = 0;

    for (let i = 0; i < factor - 1; i += 1) {
      total += Number(digits[i]) * (factor - i);
    }

    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calculateDigit(10) === Number(digits[9]) && calculateDigit(11) === Number(digits[10]);
}

export function validateRegistration(data: RegistrationFormData) {
  const errors: RegistrationErrors = {};
  const nameParts = data.fullName.trim().split(/\s+/).filter(Boolean);
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim());
  const phoneDigits = onlyDigits(data.phone);
  const emergencyPhoneDigits = onlyDigits(data.emergencyContactPhone);
  const birthDate = data.birthDate ? new Date(`${data.birthDate}T00:00:00`) : null;
  const today = new Date();

  if (nameParts.length < 2) {
    errors.fullName = 'Informe nome e sobrenome.';
  }

  if (!emailIsValid) {
    errors.email = 'Informe um e-mail valido.';
  }

  if (!isValidCpf(data.cpf)) {
    errors.cpf = 'Informe um CPF valido.';
  }

  if (phoneDigits.length < 10) {
    errors.phone = 'Informe um WhatsApp valido com DDD.';
  }

  if (birthDate && (Number.isNaN(birthDate.getTime()) || birthDate > today || birthDate.getFullYear() < today.getFullYear() - 100)) errors.birthDate = 'Informe uma data de nascimento valida.';
  if (data.emergencyContactName.trim() && data.emergencyContactName.trim().split(/\s+/).filter(Boolean).length < 2) errors.emergencyContactName = 'Informe nome e sobrenome do contato.';
  if (emergencyPhoneDigits.length > 0 && emergencyPhoneDigits.length < 10) errors.emergencyContactPhone = 'Informe um telefone de emergencia valido.';

  if (!data.gender || !allowedGenders.has(data.gender)) {
    errors.gender = 'Selecione feminino ou masculino.';
  }

  if (!allowedDistances.has(data.distance)) {
    errors.distance = 'Selecione uma distancia valida.';
  }

  if (!allowedShirtSizes.has(data.shirtSize)) {
    errors.shirtSize = 'Selecione um tamanho de camisa valido.';
  }

  if (requireRegistrationAcceptances) {
    if (!data.termsAccepted) {
      errors.termsAccepted = 'Aceite o termo de responsabilidade.';
    }

    if (!data.regulationAccepted) {
      errors.regulationAccepted = 'Aceite o regulamento.';
    }

    if (!data.privacyAccepted) {
      errors.privacyAccepted = 'Aceite a politica de privacidade.';
    }
  }

  return errors;
}
