# Barbearia — homepage única com agendamento

Modelo genérico em HTML, CSS, JavaScript, Node.js/Express e SQLite. A experiência pública inteira está em uma homepage; o painel abre em um modal na própria página. O servidor valida e grava cada reserva numa transação, impedindo a ocupação simultânea do mesmo horário.

## Iniciar localmente

Requisitos: Node.js 20.11+ e pnpm 11. Copie `.env.example` para `.env`, gere dois segredos aleatórios com pelo menos 32 caracteres para `ADMIN_SETUP_TOKEN` e `ADMIN_SESSION_SECRET` (por exemplo, `openssl rand -hex 32`) e não publique o `.env`. O token de exemplo é recusado pelo endpoint; em `NODE_ENV=production`, o processo encerra a inicialização se qualquer um dos dois segredos estiver ausente, fraco ou ainda for um placeholder.

```bash
pnpm install
pnpm dev
```

Abra `http://localhost:3000`, selecione **Área do barbeiro** e crie a conta inicial com o token do servidor. Use uma senha com pelo menos 12 caracteres. A senha é armazenada com `scrypt`; o token só funciona antes de existir um administrador.

`pnpm check` valida a sintaxe e `pnpm test` roda os testes. O valor padrão `HOST=127.0.0.1` é para desenvolvimento local. Em produção, use `NODE_ENV=production`, HTTPS, variáveis seguras do provedor e o `PORT` que ele fornecer. Se o app estiver atrás de um único proxy reverso confiável, defina `TRUST_PROXY=1`; não habilite isso atrás de proxies desconhecidos.

## Personalizar para cada barbearia

Edite `config/site.json`: nome, textos, endereço, mapa, WhatsApp público, fuso, horário, serviços, preço em centavos, duração, equipe, depoimentos e caminhos das fotos. Para a identidade, edite `colors.ink`, `paper`, `accent`, `accentDark` e `sage`; o servidor entrega a paleta como `/theme.css`, aceitando somente valores hexadecimais. Escolha cores com contraste adequado.

Troque os arquivos de `public/img/` mantendo os nomes ou atualize os caminhos no JSON. O logo SVG atual é só um marcador. As fotos, preços, horários e avaliações incluídos são demonstrativos; use imagens autorizadas e só publique avaliações reais com autorização.

## Agenda e painel

O cliente escolhe serviço, barbeiro, data e horário. Horários livres aparecem verdes e clicáveis; horários ocupados ficam grafite, identificados como “Ocupado” e desabilitados. Horários passados aparecem como “Passou”. A reserva é revalidada pelo servidor e bloqueia imediatamente o intervalo. O painel permite marcar **Compareceu**, **Faltou** ou cancelar. Se uma reserva continuar ativa 15 minutos depois do fim previsto, o sistema registra a falta e enfileira um alerta ao proprietário.

O nome, telefone e detalhes da reserva aparecem no painel e são enviados ao WhatsApp da barbearia. A autorização para lembretes ao WhatsApp do cliente é opcional; sem ela, a reserva segue normalmente, mas os lembretes ao cliente não são enviados.

## WhatsApp

A integração usa a WhatsApp Cloud API oficial da Meta. Requer conta Business, token, número ativo, segredo/verificação do app, webhook HTTPS e templates Utility aprovados. Configure as variáveis `WHATSAPP_*` no ambiente do servidor; nunca guarde tokens em `public/` ou `config/site.json`.

Quando estiver configurado, o aviso de nova reserva é enfileirado logo após salvar. Os lembretes ao cliente são programados para 24 horas e 1 hora antes, com respostas rápidas **Confirmo** e **Cancelo**. A fila persiste no SQLite e retenta falhas temporárias. Sem credenciais/templates ativos, as reservas continuam funcionando e o site informa que os avisos automáticos não estão habilitados. Consulte `docs/WHATSAPP-SETUP.md`.

## Hospedagem e dados

Esta versão precisa de um host Node com HTTPS, volume persistente e um único processo ativo. Configure `DATA_DIR` para o volume. SQLite fica fora da pasta pública. Hospedagem serverless, disco temporário ou várias instâncias não dão as mesmas garantias de persistência e agendamento; para esses casos, substitua a base por um banco compartilhado e use uma fila/job persistente.

Faça backups regulares do diretório de dados e teste a restauração. Personalize `docs/PRIVACIDADE.md`, o canal de contato e a retenção antes de receber clientes. O texto é um ponto de partida e não aconselhamento jurídico.

## Rotas

`GET /` serve a homepage única. A agenda usa `/api/availability` e `/api/appointments`, o painel usa `/api/admin/*`, e o webhook da Meta usa `/api/webhooks/whatsapp`. `GET /manus-routes.json` declara apenas a rota `/`.
