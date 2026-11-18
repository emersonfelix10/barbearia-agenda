# Configuração de WhatsApp

A agenda e o painel não dependem de WhatsApp. Esta integração só envia mensagens depois de preencher as variáveis `WHATSAPP_*` no servidor e configurar o webhook HTTPS no painel Meta. Use um token de sistema com acesso ao número de WhatsApp Business e mantenha segredos fora do navegador, do repositório e do ZIP de exemplo.

## Variáveis do servidor

Preencha `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_OWNER_NUMBER`, `WHATSAPP_GRAPH_API_VERSION` e `WHATSAPP_TEMPLATE_LANGUAGE`. Os nomes dos templates são configuráveis por `WHATSAPP_TEMPLATE_REMINDER`, `WHATSAPP_TEMPLATE_OWNER_BOOKING` e `WHATSAPP_TEMPLATE_OWNER_NO_SHOW`.

Cadastre em Meta Developers o webhook `https://SEU-DOMINIO/api/webhooks/whatsapp`, informe `WHATSAPP_VERIFY_TOKEN` como token de validação e assine o campo de mensagens. `WHATSAPP_APP_SECRET` valida a assinatura do POST. Use HTTPS e confira os eventos de mensagem no painel Meta.

## Modelos Utility sugeridos

Crie e obtenha aprovação para estes templates em português do Brasil antes de ativar a automação:

- Lembrete `appointment_reminder_utility`, com corpo e variáveis: `{{1}}` nome da barbearia, `{{2}}` nome do cliente, `{{3}}` serviço, `{{4}}` barbeiro, `{{5}}` data, `{{6}}` hora e `{{7}}` antecedência (“24 horas” ou “1 hora”). Inclua dois botões **Quick Reply** com os rótulos exatos `Confirmo` e `Cancelo`. O sistema envia um payload exclusivo por reserva; o webhook usa esse payload para confirmar/cancelar e verifica o telefone remetente.
- Aviso ao dono `owner_new_booking_utility`, com `{{1}}` negócio, `{{2}}` cliente, `{{3}}` telefone, `{{4}}` serviço, `{{5}}` barbeiro, `{{6}}` data e `{{7}}` hora.
- Falta `owner_no_show_utility`, com `{{1}}` negócio, `{{2}}` cliente, `{{3}}` serviço, `{{4}}` barbeiro, `{{5}}` data e `{{6}}` hora.

Se alterar a ordem do corpo, atualize `src/whatsapp.js`. O sistema agenda lembretes apenas quando o cliente marcou a caixa de autorização. Horários dos avisos são calculados pelo fuso `timeZone` em `config/site.json`.

A API Meta usa modelos aprovados para mensagens iniciadas pelo negócio fora da janela de atendimento e requer opt-in. Uma resposta HTTP aceita pela API não comprova entrega; consulte os webhooks/status no painel. Leia `whatsapp-sources.md` para as referências oficiais utilizadas.
