# Operação da agenda

## Primeiro acesso

Use Node.js 20.11 ou superior e pnpm 11. Copie `.env.example` para `.env` em um teste local. Gere `ADMIN_SETUP_TOKEN` e `ADMIN_SESSION_SECRET` como valores aleatórios longos. Em produção, prefira o painel seguro do provedor para armazenar variáveis, use `NODE_ENV=production`, HTTPS, `HOST=0.0.0.0`, o `PORT` indicado pelo host e um volume persistente em `DATA_DIR`. Se estiver atrás de um único proxy reverso confiável, defina `TRUST_PROXY=1`; não confie em cabeçalhos encaminhados por proxies não controlados.

Edite `config/site.json` com nome, textos, endereço, mapa, fotos, serviços, preços em centavos, duração, horários, fuso, paleta e barbeiros. Em desenvolvimento, execute `pnpm install` e `pnpm dev`; em produção, use `pnpm start`. Abra a homepage e selecione **Área do barbeiro**. Antes de haver um administrador, use o token inicial para criar a conta com senha de pelo menos 12 caracteres. O token de setup deixa de funcionar assim que a conta existe.

Para lembretes, configure a conta WhatsApp Business/Meta, token, número, webhook HTTPS e templates Utility aprovados conforme `WHATSAPP-SETUP.md`. Faça um teste com contatos que autorizaram mensagens. Sem essa integração, as reservas continuam disponíveis e o site informa que nenhum WhatsApp automático foi enviado.

## Uso diário

O cliente escolhe serviço, barbeiro, data e horário na homepage. Horários livres ficam verdes e clicáveis; horários reservados aparecem em grafite como “Ocupado”, sem permitir clique. Horários passados aparecem como “Passou”. O servidor verifica de novo a disponibilidade no momento de salvar a reserva.

O aviso ao proprietário entra na fila logo depois que a reserva é gravada. O cliente pode autorizar lembretes pelo próprio WhatsApp. O botão **Confirmo** atualiza a reserva para confirmada; **Cancelo** cancela e libera o horário.

No painel, escolha o dia e marque uma reserva ativa como **Compareceu** ou **Faltou**, ou cancele-a. Se permanecer ativa até 15 minutos depois do fim previsto, o sistema registra a falta e enfileira o aviso ao proprietário. Mantenha o processo Node ativo para que a fila e os estados atrasados sejam processados.

## Dados e segurança

A base SQLite armazena reservas, estados, sessões administrativas e fila de notificações. Preserve o diretório `DATA_DIR` em backups regulares e teste a restauração. Use HTTPS em produção, segredos fortes e acesso administrativo restrito; nunca publique `.env`. Esta versão presume um processo ativo e um volume persistente, não uma pasta efêmera nem uma implantação serverless sem armazenamento durável.

O site explica que nome, telefone e detalhes da reserva são usados pela barbearia. Os lembretes enviados ao telefone do cliente dependem de autorização opcional. Antes de publicar, substitua conteúdo e fotos de demonstração e personalize o aviso de privacidade, o canal para solicitações e o período de retenção. O manual é técnico e não é aconselhamento jurídico.
