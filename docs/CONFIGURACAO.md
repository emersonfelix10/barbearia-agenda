# Configuração do negócio

A homepage lê os dados públicos em `config/site.json`. Edite ali o nome, a tagline, o texto curto, o endereço, o link do mapa, o número público de WhatsApp, as fotos, o fuso, os horários, os serviços, os profissionais e os depoimentos de exemplo. O navegador atualiza o título da página com o nome do negócio.

Os preços são armazenados em centavos: `3500` representa R$ 35,00. A duração de um atendimento é informada em minutos. `phoneCountryCode` define o código telefônico que o servidor acrescenta aos números locais; o modelo inicia em `55` para o Brasil. Números brasileiros com DDD e prefixo de operadora são normalizados antes de armazenar a reserva.

A identidade visual pode ser trocada em `colors.ink`, `colors.paper`, `colors.accent`, `colors.accentDark` e `colors.sage`. A aplicação entrega essas cores em `/theme.css`, aceitando apenas valores hexadecimais de seis dígitos. `accentDark` é o tom para textos brancos em botões; prefira cores escuras para manter contraste. A mudança de cor não altera fotos ou conteúdo.

Use caminhos locais começando por `/img/`. O logo `logo-barbearia.svg` e as fotos incluídas são apenas marcadores/demonstrações. Troque-os por imagens de sua propriedade ou licenciadas e atualize os nomes no JSON. O endereço e `mapUrl` devem corresponder ao mesmo local; links do mapa precisam usar HTTPS.

`whatsappContact` é o contato público da homepage. O telefone que recebe os avisos administrativos é `WHATSAPP_OWNER_NUMBER` no ambiente do servidor; ele nunca é incluído na configuração enviada ao navegador. Tokens e segredos do WhatsApp ficam somente em `.env`/no provedor, nunca neste JSON.

Os textos, preços, horários, contatos e avaliações atuais são exemplos. Não publique avaliações demonstrativas como se fossem depoimentos reais. A configuração é lida na inicialização do servidor; reinicie o processo depois de alterá-la.
