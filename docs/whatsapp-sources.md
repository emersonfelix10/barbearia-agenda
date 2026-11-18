# WhatsApp Cloud API — fontes e decisões

A integração prevista usa a WhatsApp Cloud API da Meta. O sistema exige uma conta Business Platform configurada pelo responsável da barbearia; este projeto não contém token, número real nem modelos aprovados.

A documentação oficial descreve modelos interativos com quick replies, que aceitam até três botões, requerem template criado/aprovado e usam componentes `button`/`quick_reply` com `payload` por envio. O clique retorna um webhook com `type: "button"` e `button.payload`; o app relacionará esse payload a uma reserva e também validará o número remetente antes de alterar estado.

A API oficial usa `POST /{WHATSAPP_BUSINESS_PHONE_NUMBER_ID}/messages`. Fora da janela de atendimento de 24 horas, mensagens iniciadas pelo negócio devem usar templates aprovados. Os destinatários precisam ter optado por receber as mensagens. O endpoint aceitar uma mensagem não prova sua entrega; status de entrega chegam por webhook.

Na configuração do projeto, o modelo Utility de lembrete deve ter os parâmetros de corpo documentados em `docs/WHATSAPP-SETUP.md` e dois botões Quick Reply chamados “Confirmo” e “Cancelo”. O alerta ao dono também usa template aprovado para funcionar fora da janela de atendimento.

## Referências oficiais

- [1]: https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/ "Sending Interactive Message Templates"
- [2]: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button "Button messages webhook reference"
- [3]: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages "Service messages and Messages API"
- [4]: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started "WhatsApp Cloud API Get Started"

Atualizado para a documentação pública consultada em 18 de novembro de 2026. A Meta pode alterar versões, requisitos, aprovação e preços; confirmar tudo no painel Business Manager antes de publicar.
