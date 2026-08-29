import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FAQSection } from '../src/components/faq';
import { FormField } from '../src/components/ui/FormField';
import { StatusMessage } from '../src/components/ui/StatusMessage';

test('FormField associates label, description, and error with its control', () => {
  const markup = renderToStaticMarkup(createElement(
    FormField,
    {
      id: 'registration-email',
      name: 'email',
      label: 'E-mail',
      description: 'Use um endereço válido.',
      error: 'Informe um e-mail válido.',
      required: true,
      autoComplete: 'email',
      children: createElement('input', { type: 'email' }),
    },
  ));

  assert.match(markup, /for="registration-email"/);
  assert.match(markup, /id="registration-email"/);
  assert.match(markup, /name="email"/);
  assert.match(markup, /autoComplete="email"/);
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /aria-describedby="registration-email-description registration-email-error"/);
  assert.match(markup, /id="registration-email-error"/);
  assert.match(markup, /Erro:/);
});

test('StatusMessage exposes urgent errors and non-urgent status updates', () => {
  const errorMarkup = renderToStaticMarkup(createElement(StatusMessage, { tone: 'error', title: 'Erro', children: 'Falha local.' }));
  const infoMarkup = renderToStaticMarkup(createElement(StatusMessage, { tone: 'info', title: 'Informação', children: 'Processando.' }));

  assert.match(errorMarkup, /role="alert"/);
  assert.match(infoMarkup, /role="status"/);
});

test('FAQ disclosure exposes expanded state and controlled region', () => {
  const markup = renderToStaticMarkup(createElement(FAQSection));

  assert.match(markup, /id="faq-question-0"/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /aria-controls="faq-answer-0"/);
  assert.match(markup, /id="faq-answer-0"/);
  assert.match(markup, /role="region"/);
  assert.match(markup, /aria-labelledby="faq-question-0"/);
  assert.match(markup, /aria-expanded="false"/);
});

test('reduced-motion contract disables continuous and transform motion', async () => {
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const reducedMotionBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

  assert.match(reducedMotionBlock, /\.marquee-track[\s\S]*animation: none !important/);
  assert.match(reducedMotionBlock, /\.marquee-track[\s\S]*transform: none !important/);
  assert.match(reducedMotionBlock, /\.gallery-image:hover[\s\S]*transform: none !important/);
  assert.match(reducedMotionBlock, /scroll-behavior: auto !important/);
});
