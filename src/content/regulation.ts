export type RegulationBlock =
  | { kind: 'clause'; number: string; text: string }
  | { kind: 'highlight'; number: string; title: string; text?: string }
  | { kind: 'schedule'; number: string; title: string; location: string; items: string[] };

export type RegulationChapter = {
  id: string;
  indexLabel: string;
  title: string;
  blocks: RegulationBlock[];
};

export const regulationChapters: RegulationChapter[] = [
  {
    id: 'capitulo-i',
    indexLabel: 'Capítulo I — A Prova',
    title: 'A Prova',
    blocks: [
      {
        kind: 'clause',
        number: '1.1.',
        text: 'FUNPACE RUN EXPERIENCE 2026 será realizada em Porto Velho - RO, no dia 20 de SETEMBRO de 2026. É uma realização do movimento Funpace.',
      },
      {
        kind: 'clause',
        number: '1.2.',
        text: 'A corrida será disputada em duas distâncias, na modalidade de 5 km e 10 km, nos gêneros masculino e feminino, sendo disputada na categoria público geral.',
      },
      {
        kind: 'clause',
        number: '1.3.',
        text: 'A largada da prova será no COMPLEXO MADEIRA MAMORÉ, com concentração dos atletas às 05:00, sob qualquer condição climática, a menos que interfira na segurança dos atletas e na logística do evento.',
      },
      {
        kind: 'schedule',
        number: '1.4.',
        title: 'PROGRAMAÇÃO:',
        location: '',
        items: [
          '05h:00m - Concentração dos atletas.',
          '05h:30m - Abertura do evento.',
          '06h:00m - Largada geral 5km e 10km.',
          '08h:00m - Aniversário FUNPACE (AFTER com DJ).',
        ],
      },
      {
        kind: 'clause',
        number: '1.5.',
        text: 'Premiação entre 08h e 09h.',
      },
      {
        kind: 'clause',
        number: '1.6.',
        text: 'A corrida terá duração máxima de 2h00min.',
      },
      {
        kind: 'clause',
        number: '1.7.',
        text: 'O horário de largada da prova poderá sofrer alterações em função do número de inscritos, mudanças no percurso ou por orientação da equipe técnica. Alterações também poderão ocorrer por motivos externos, como questões de segurança pública, regulamentações ou decretos vigentes, pandemias, epidemias, tráfego intenso, falhas de comunicação, interrupções no fornecimento de energia, entre outros fatores que possam comprometer a realização do evento.',
      },
      {
        kind: 'clause',
        number: '1.8.',
        text: 'IDADE MÍNIMA - Os(as) atletas menores de 18 anos só poderão participar da corrida com autorização por escrito com firma reconhecida do pai, da mãe ou de responsável legal. A autorização deverá estar acompanhada de cópia de um documento de identidade que será retido pela organização no momento da retirada do kit. Em cumprimento às Regras Oficiais da IAAF/CBAt, segue a idade mínima para atletas participarem de corridas de rua: 1 - Provas com percurso até 5km: 14 (catorze) anos completos até 31 de dezembro do ano da prova; 2 - Provas com percurso menor que 10km: 16 (dezesseis) anos completos até 31 de dezembro do ano da prova;',
      },
    ],
  },
  {
    id: 'capitulo-ii',
    indexLabel: 'Capítulo II — Premiação',
    title: 'Premiação',
    blocks: [
      {
        kind: 'clause',
        number: '2.1.',
        text: 'Todos os atletas que cruzarem a linha de chegada de forma legal, que estiverem regularmente inscritos e sem o descumprimento deste regulamento, receberão 01 (uma) medalha de participação.',
      },
      {
        kind: 'clause',
        number: '2.2.',
        text: 'A distância de 5km e 10km terá premiação aos inscritos que concluírem a prova entre a 1ª e a 3ª colocação nas categorias público geral, nos gêneros masculino e feminino. Receberão além da medalha de participação, 1 (um) troféu.',
      },
      {
        kind: 'clause',
        number: '2.3.',
        text: 'Não serão entregues medalhas e brindes pós-prova para as pessoas que, mesmo inscritas, não participaram da prova.',
      },
      {
        kind: 'clause',
        number: '2.4.',
        text: 'Para receber a medalha de participação é obrigatório que o (a) atleta esteja portando o número de peito.',
      },
      {
        kind: 'clause',
        number: '2.5.',
        text: 'Só será entregue 1 (uma) medalha por atleta.',
      },
      {
        kind: 'clause',
        number: '2.6.',
        text: 'A cerimônia de premiação será realizada imediatamente após a chegada dos(as) primeiros(as) colocados(as), em local previamente divulgado pela organização. O(a) atleta premiado(a) deverá estar presente no momento da chamada oficial ao pódio, devidamente identificado(a) com o número de peito e/ou documento oficial com foto.',
      },
      {
        kind: 'clause',
        number: '2.7.',
        text: 'A ausência do(a) atleta no ato da premiação implicará na perda automática do direito ao troféu, brindes e/ou eventuais prêmios oferecidos. Não será permitida a retirada de troféus ou prêmios por terceiros, salvo em situações excepcionais previamente autorizadas pela organização.',
      },
    ],
  },
  {
    id: 'capitulo-iii',
    indexLabel: 'Capítulo III — Inscrição',
    title: 'Inscrição',
    blocks: [
      {
        kind: 'clause',
        number: '3.1.',
        text: 'De acordo com a determinação da Confederação Brasileira de Atletismo (CBAt), em sua NORMA 12, Art. 1º, § 9º, que regulamenta as categorias oficiais do Atletismo Brasileiro, a IDADE MÍNIMA para atletas participarem do percurso até 5km: 14 (catorze) anos completos até 31 de dezembro do ano da prova e 10km: 16 (dezesseis) anos completos até 31 de dezembro do ano da prova.',
      },
      {
        kind: 'clause',
        number: '3.2.',
        text: 'No ato da inscrição, ao concordar com o regulamento geral da FUNPACE RUN EXPERIENCE 2026, por meio da opção disponibilizada no sistema online, o participante declara estar de acordo com todos os termos e regras do evento, assumindo total responsabilidade por sua participação na prova, conforme descrito no Termo de Responsabilidade, parte integrante deste regulamento.',
      },
      {
        kind: 'clause',
        number: '3.3.',
        text: 'A organização da FUNPACE RUN EXPERIENCE 2026 se compromete a cumprir todas as disposições da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais – LGPD), observando rigorosamente os princípios da finalidade, adequação, necessidade, transparência, livre acesso, segurança, prevenção, não discriminação e responsabilização no tratamento dos dados pessoais dos participantes.',
      },
      {
        kind: 'clause',
        number: '3.4.',
        text: 'As inscrições serão realizadas somente através do site https://funpance.club, não havendo outros postos de inscrição.',
      },
      {
        kind: 'clause',
        number: '3.5.',
        text: 'Retirada do Kit Atleta: O local, a data e o horário para a retirada dos kits serão divulgados aproximadamente 1 semana antes do evento. Todas as informações oficiais serão publicadas em nossos canais de comunicação e enviadas aos atletas inscritos. Fique atento ao seu e-mail e às redes sociais da Funpace para acompanhar as atualizações.',
      },
    ],
  },
  {
    id: 'capitulo-iv',
    indexLabel: 'Capítulo IV — Número de Peito e Cronometragem',
    title: 'Número de Peito e Cronometragem',
    blocks: [
      {
        kind: 'clause',
        number: '4.1.',
        text: 'O uso do número de peito é obrigatório.',
      },
      {
        kind: 'clause',
        number: '4.2.',
        text: 'O número de peito deve ser fixado no peito. O posicionamento inadequado é de responsabilidade única do atleta, assim como as consequências de sua não utilização.',
      },
      {
        kind: 'clause',
        number: '4.3.',
        text: 'Somente o atleta com número de peito tem acesso às áreas de largada, chegada, medalha e serviços de prova.',
      },
      {
        kind: 'clause',
        number: '4.4.',
        text: 'Ao final da prova, o participante que cruzar a linha de chegada portando o número de peito, receberá 01 medalha de participação.',
      },
    ],
  },
  {
    id: 'capitulo-v',
    indexLabel: 'Capítulo V — Instruções Gerais',
    title: 'Instruções e regras gerais',
    blocks: [
      {
        kind: 'clause',
        number: '5.1.',
        text: 'No ato da inscrição, ao concordar com o regulamento, assinalando a opção apresentada no sistema on-line, o (a) atleta aceita todos os termos do regulamento e assume total responsabilidade por sua participação no evento.',
      },
      {
        kind: 'clause',
        number: '5.2.',
        text: 'Os atletas são responsáveis pela veracidade das informações fornecidas no sistema online. Os atletas concordam que o e-mail será o meio de comunicação utilizado pela empresa organizadora para repassar informações e atualizações referentes à corrida.',
      },
      {
        kind: 'clause',
        number: '5.3.',
        text: 'A inscrição na corrida é pessoal e intransferível, não podendo qualquer atleta ser substituída por outra, em qualquer situação.',
      },
      {
        kind: 'clause',
        number: '5.4.',
        text: 'O atleta que ceder seu número de peito para outra pessoa será responsável por qualquer acidente ou dano que esta venha a sofrer, isentando o atendimento e qualquer responsabilidade da empresa organizadora, seus patrocinadores, apoiadores e órgãos públicos.',
      },
      {
        kind: 'clause',
        number: '5.5.',
        text: 'Os atletas com idade igual ou maior a 14 anos poderão participar da corrida de 5 km e 10km mediante autorização por escrito dos pais ou de um responsável. A autorização deverá estar acompanhada de cópia de um documento de Identidade do menor de idade, que será retida pela empresa organizadora, no ato de entrega dos kits. A idade a ser considerada, obrigatoriamente, para os efeitos de inscrição e classificação por faixa etária é a que o atleta terá em dezembro do ano em que for realizada a corrida.',
      },
      {
        kind: 'clause',
        number: '5.6.',
        text: 'O (a) atleta que não retirar o seu kit na data e horário estipulado pela organização não terá direito do mesmo após o evento.',
      },
      {
        kind: 'clause',
        number: '5.7.',
        text: 'O Kit somente poderá ser retirado pelo (a) atleta inscrito mediante apresentação do documento de confirmação de inscrição, o respectivo recibo de pagamento e documento oficial com foto',
      },
      {
        kind: 'clause',
        number: '5.8.',
        text: 'A retirada de kits só poderá ser efetivada por terceiros mediante a apresentação do documento com foto de identificação do inscrito que poderá ser digitalizada.',
      },
      {
        kind: 'clause',
        number: '5.9.',
        text: 'No momento da retirada do kit o responsável deverá conferir os seus dados e o número do peito.',
      },
      {
        kind: 'clause',
        number: '5.10.',
        text: 'Não serão aceitas reclamações cadastrais como também dos itens que compõe o kit, após sua retirada.',
      },
      {
        kind: 'clause',
        number: '5.11.',
        text: 'O (a) atleta está autorizado a correr com sua própria camiseta.',
      },
      {
        kind: 'clause',
        number: '5.12.',
        text: 'A cada atleta será fornecido um número que deve ser usado visivelmente no peito, sem rasura ou alterações, durante toda a realização da corrida, sendo passíveis de desclassificação os atletas que não cumprirem esta obrigação.',
      },
      {
        kind: 'clause',
        number: '5.13.',
        text: 'A empresa organizadora poderá, a seu critério ou conforme as necessidades da corrida, alterar ou revogar este regulamento, total ou parcialmente, informando as mudanças pelo site oficial da corrida.',
      },
    ],
  },
];
