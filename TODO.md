# Critérios de aceite — Barbearia one-page

## Homepage única e editável
- [x] Toda a experiência fica em uma homepage, sem várias páginas/abas, com conteúdo curto e genérico para trocar nome, fotos, preços, WhatsApp e identidade visual.
- [x] Cabeçalho com nome da barbearia, espaço para logo e botão grande “Agendar Agora”.
- [x] Seção Sobre com texto curto e direto e fotos substituíveis do espaço.
- [x] Serviços com nome, preço e duração, incluindo corte, barba e combo.
- [x] Galeria com fotos de cortes e trabalhos.
- [x] Equipe com nome e foto demonstrativa de cada barbeiro.
- [x] Depoimentos com estrelas, claramente identificados como demonstrativos até serem trocados por avaliações reais.
- [x] Contato com mapa/link, WhatsApp e endereço editáveis; mapa permanece demonstrativo até configurar o endereço.
- [x] Botão fixo de agendamento visível em celular.
- [x] Layout responsivo, navegação pelo teclado, alvos móveis e foco visível.

## Agendamento e disponibilidade
- [x] Cliente escolhe serviço, barbeiro, dia e horário dentro da homepage.
- [x] Horários livres aparecem verdes e são clicáveis.
- [x] Horários ocupados aparecem em quadrado grafite com “Ocupado” e ficam desabilitados; horários passados também não podem ser selecionados.
- [x] A reserva é revalidada e gravada no servidor; o intervalo bloqueia novas escolhas imediatamente, inclusive em concorrência.
- [x] A homepage confirma a reserva e mostra um resumo.

## WhatsApp e notificações
- [x] Com a WhatsApp Cloud API configurada e o cliente tendo autorizado, lembretes são enfileirados para 24 horas e 1 hora antes, com respostas rápidas “Confirmo” e “Cancelo”.
- [x] “Confirmo” registra confirmação; “Cancelo” cancela a reserva, libera o horário e encerra lembretes pendentes.
- [x] O aviso de nova reserva ao dono é enfileirado assim que a reserva é persistida.
- [x] Se passar o horário sem registro de “Compareceu”, depois de tolerância configurável o sistema marca falta e enfileira um aviso ao dono.
- [x] O formulário pede autorização para lembretes por WhatsApp.
- [x] Sem credenciais válidas, a página deixa claro que a agenda continua, mas mensagens automáticas não foram enviadas.
- [ ] Associar credenciais, número e templates reais da conta Meta da barbearia; nenhum acesso ou telefone foi fornecido nesta tarefa.

## Painel do barbeiro e primeiro acesso
- [x] Painel administrativo simples, dentro da homepage, com criação inicial e login; o barbeiro marca reserva como “Compareceu” ou “Faltou”.
- [x] Estados e ações atualizam a reserva e respeitam bloqueio/liberação de horários.
- [x] O servidor rejeita tokens de setup demonstrativos/fracos; em produção o servidor não inicia sem `ADMIN_SETUP_TOKEN` e `ADMIN_SESSION_SECRET` fortes.

## Entrega e configuração
- [x] Fotos, logo, textos, identidade visual, serviços, preços, equipe, endereço e WhatsApp podem ser substituídos via configuração/documentação sem reconstruir o layout.
- [x] Nenhum segredo da API do WhatsApp fica no JavaScript público ou no pacote de exemplo.
- [x] Projeto inclui instruções de início, personalização, configuração WhatsApp, operação e hospedagem Node com volume persistente.
- [x] `pnpm check` e os testes automatizados passam; cobrem disponibilidade, concorrência, cancelamento, login/setup, estado de reserva, fila simulada e assets da homepage.
- [ ] Implantar em hospedagem real com armazenamento persistente e verificar credenciais/templates Meta do estabelecimento.
- [x] ZIP de projeto-fonte criado e validado; não inclui dependências instaladas, `.env` nem banco local.
