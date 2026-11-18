# Plano de implementação — Barbearia One-page com agenda

## Abordagem

Entregar uma homepage única, em HTML/CSS/JavaScript, para uma barbearia genérica. A página tem apresentação, serviços com preço e duração, galeria, equipe, avaliações demonstrativas, agenda, contato/mapa e botão de agendamento fixo no celular. O painel do barbeiro abre em um modal no mesmo HTML.

Um servidor Node.js/Express serve a homepage, as imagens e a API. A disponibilidade é calculada no fuso do negócio. A reserva volta a ser validada dentro de uma transação SQLite antes de gravar, para impedir conflito quando duas pessoas escolhem o mesmo intervalo. O arquivo de dados fica fora da pasta pública e deve residir em armazenamento persistente. Esta versão presume um processo/instância ativo; a tarefa periódica não depende de abas do navegador.

O primeiro acesso administrativo exige `ADMIN_SETUP_TOKEN`. Senhas ficam com hash `scrypt`, sessões usam token aleatório assinado e guardado em hash, e a mutação passa por validação de origem e limites de tentativas. O painel é deliberadamente curto: lista do dia, atualização e estados **Compareceu**, **Faltou** e cancelamento.

A API de WhatsApp é opcional e fica só no servidor. Cada evento entra em uma fila persistida. Com a Cloud API configurada, o estabelecimento recebe o aviso de nova reserva; clientes que derem opt-in recebem os lembretes de 24h e 1h com quick replies “Confirmo” e “Cancelo”. O webhook só aceita assinatura válida e verifica o telefone do remetente antes de mudar o estado. Se uma reserva continuar ativa 15 minutos após o fim previsto, o scheduler marca falta e enfileira o aviso ao estabelecimento. Sem credenciais e templates aprovados, a agenda continua funcionando e o site avisa que nenhuma mensagem automática está habilitada.

Não foram fornecidos endereço, marca, nomes, contatos ou preços reais. Os exemplos do JSON e as fotografias de bancos de imagem são demonstrativos. Antes de publicar, o cliente troca as informações, confirma os direitos das fotos, adiciona endereço e WhatsApp, substitui qualquer avaliação de exemplo por uma avaliação real autorizada e define a política de retenção.

## Estrutura do projeto

- `public/index.html`: única homepage; o painel é modal, não uma página separada.
- `public/styles.css`: layout, tipografia local, estados de disponibilidade, acessibilidade e breakpoints.
- `public/app.js`: renderização dos dados públicos, seletor de serviço/barbeiro/data, horários, formulário, navegação e painel.
- `public/img/`: logo provisória substituível e fotos demonstrativas locais.
- `config/site.json`: conteúdo, serviços, equipe, preços, agenda e paleta editáveis.
- `src/server.js`: rotas Express, proteções HTTP, serving da homepage e CSS de tema gerado apenas com cores hex válidas.
- `src/database.js`: esquema, transações e persistência do SQLite WebAssembly em `data/`.
- `src/appointments.js`: validação de disponibilidade, conflito, reserva e estados do atendimento.
- `src/auth.js`: configuração inicial, senha, sessões e autorização do painel.
- `src/whatsapp.js`: chamadas à Cloud API, templates e webhook assinado.
- `src/scheduler.js`: envio com retentativas, lembretes e detecção de ausência.
- `.env.example`: nomes das variáveis de ambiente, sem credenciais ativas.
- `docs/`: instalação, operação, personalização, privacidade, integração WhatsApp e proveniência das imagens.
- `test/`: cenários de agenda, conflito, administração, fila e mensagens simuladas.

## Design

Alternativas amostradas com probabilidades abaixo de 0,10:
- 0,04 — editorial de barbearia contemporânea: foto documental, grafite, marfim e cobre.
- 0,02 — oficina clássica: madeira, couro, latão e listras de barber pole.
- 0,07 — brutalismo urbano: tipografia larga, alto contraste e sinais de rua.

**Escolha:** editorial de barbearia contemporânea.

- **Design Movement:** revista masculina contemporânea combinada a um estúdio de grooming de bairro.
- **Core Principles:** contraste legível; fotografia humana; informação prática acima de decoração; a agenda não esconde horários ocupados.
- **Color Philosophy:** grafite e marfim trazem presença; cobre queimado identifica a marca e chama para agendar; verde sálvia escuro identifica disponibilidade sem se confundir com texto ilegível.
- **Layout Paradigm:** hero assimétrico de texto e fotografia; seções em faixas editoriais; escolha progressiva em uma área clara; barra fixa de agendamento no celular.
- **Signature Elements:** selo circular de agenda; enquadramento fino de cobre; horários retangulares com rótulo de estado.
- **Interaction Philosophy:** alvos grandes para toque; horários livres coloridos e clicáveis; ocupados escuros e desabilitados; confirmação com revalidação no servidor.
- **Animation:** hover/press curto, foco visível, animações reduzidas por `prefers-reduced-motion`; movimento nunca atrasa a reserva.
- **Typography System:** Georgia/serif local para títulos; fonte de sistema sem serifa para textos; números de preços e horários tabulares.
- **Brand Essence:** “Agende seu corte sem esperar, no seu horário.” Personalidade: segura, acolhedora, direta.
- **Brand Voice:** frases curtas e próximas. Exemplos: “Escolhe o serviço, vê o horário e a cadeira fica reservada.” e “Agenda aberta. Chega no teu horário.”
- **Wordmark & Logo:** espaço substituível com um monograma circular e detalhe de poste de barbear; `logo-barbearia.svg` é apenas um marcador visual.
- **Signature Brand Color:** cobre queimado `#C66E43`, com tons escuros para manter contraste em botões.

## Dependências e limites

Node.js 20.11+, pnpm 11, Express, `sql.js`, Luxon e dotenv. A homepage e os recursos visuais não usam bibliotecas externas no navegador. WhatsApp requer Business Platform da Meta, webhook HTTPS, número habilitado, segredos, opt-in e templates aprovados. A integração não envia mensagens de verdade até ser configurada no ambiente servidor. Hospedagem serverless, disco efêmero ou várias instâncias não satisfazem esta versão SQLite + scheduler local; nesse caso, a arquitetura deve migrar para banco compartilhado e fila persistente.
