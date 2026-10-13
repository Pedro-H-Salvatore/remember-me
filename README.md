# Remember me — agenda e organização pessoal

Aplicação em português do Brasil, com servidor Node.js 24, banco SQLite persistente, autenticação por conta e interface responsiva. Não usa dados fictícios nem armazenamento local do navegador como banco; `localStorage` guarda apenas o tema.

## Situação da entrega

- Implementação executável localmente: calendário mensal/semanal/diário, compromissos, prazos, categorias, notas, quadros, leitura e saúde.
- Lembretes executados no servidor, com fila persistente, tentativas, trava de processamento e chave de idempotência. **E-mails reais não foram enviados nesta entrega: configure Resend e confirme o destinatário.**
- CI, build Docker, publicação por SSH, monitoramento e rollback estão definidos no repositório. **Não foram executados no GitHub ou em uma hospedagem real**, pois esta sessão não tem repositório remoto, destino de publicação nem credenciais desses serviços.
- A conexão nativa do Sites não estava disponível; este projeto é independente e pode ser hospedado em servidor com Docker. Desenvolvimento local não proporciona acesso remoto por si só.

## Executar no computador

Requisito: Node.js 24 (inclui `node:sqlite`). Não há dependências de terceiros no servidor em execução.

```powershell
Copy-Item .env.example .env
npm ci
npm start
```

Abra http://localhost:3000, clique em **Criar conta** e use uma senha com pelo menos 12 caracteres. A base e os anexos ficam em `data/`. Reiniciar o processo mantém os registros. Para desenvolvimento com reinício automático: `npm run dev`.

O comando `npm start` funciona mesmo antes de instalar as dependências de desenvolvimento; `npm ci` instala TypeScript para os verificadores. Se a rede corporativa usar uma CA já confiada pelo sistema e o npm apresentar erro de certificado, execute com `NODE_OPTIONS=--use-system-ca`, sem desabilitar a validação TLS.

## Recursos e uso

| Área          | Operações                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Visão geral   | Compromissos do dia, prazos, tarefas pendentes, leituras, hidratação e notas                                                      |
| Calendário    | Mês, semana e dia; criação, edição, exclusão; observações; prazo adicional; notas vinculadas ao dia                               |
| Notas         | Pesquisa em título, texto e etiquetas; fixação; salvamento automático com estado visível e prevenção de perda                     |
| Quadros       | Quadros e colunas editáveis; cards com descrição, cor, etiquetas, capa, prazo, checklist e anexos; duplicação, arquivo e exclusão |
| Organização   | Arrastar cards e listas; alternativa acessível no editor do card: Lista e Posição; setas nas listas                               |
| Leitura       | Cadastro com capa, autor e páginas; Quero ler/Lendo/Concluído; histórico editável e progresso calculado a partir dos registros    |
| Saúde         | Treino, duração, água, quatro refeições; edição por dia e resumo dos sete dias até a data selecionada                             |
| Configurações | Fuso IANA, horário de lembretes, meta de água, categorias, confirmação de e-mail e resultados de envio                            |

Os cards são a própria fonte do calendário: não há um compromisso duplicado. Alterar o prazo do card altera o calendário. Marcar como concluído ou arquivar cancela os lembretes futuros. Um compromisso com data e prazo diferentes tem duas ocorrências relacionadas no calendário, ambas abrindo o mesmo editor.

Dias sem registro permanecem diferentes de “não li” e “não treinei”. O progresso de um livro soma as páginas dos registros e é limitado ao total do livro. O status do livro é selecionado pela pessoa, independentemente da porcentagem. Os registros de saúde são únicos por conta e dia.

## Configurar e-mails reais

1. Crie uma conta no Resend, valide um domínio remetente e obtenha uma chave de envio.
2. No servidor, defina `RESEND_API_KEY`, `EMAIL_FROM` (por exemplo `Remember me <agenda@seu-dominio.com>`) e `APP_URL` com a URL definitiva HTTPS. Nunca coloque a chave em código do navegador, commits ou workflows.
3. Reinicie o processo. Entre na aplicação, abra **Configurações**, envie o link de confirmação e confirme o próprio endereço. Sem essa confirmação, a fila não envia para o destinatário.
4. Crie um compromisso futuro. Consulte **Acompanhamento dos e-mails** e o painel do provedor.

O navegador pode estar fechado: o processo do servidor verifica a fila a cada 15 segundos. **O servidor precisa permanecer ligado.** Rodar apenas a prévia no computador não garante disponibilidade contínua.

Cada compromisso e prazo agenda 7 dias antes, 1 dia antes e no dia, usando a hora do compromisso ou a preferência para itens sem hora. Datas e subtração de dias usam o fuso do usuário; horários impossíveis na entrada de horário de verão são recusados e horários ambíguos usam a primeira ocorrência. Horários já passados na criação não são agendados. Alterações relevantes cancelam a geração anterior e criam somente horários futuros; exclusões cancelam as pendências. E-mails já aceitos pelo provedor não podem ser desfeitos.

A fila mantém um payload imutável por tentativa e uma chave estável do Resend. Retentativas têm backoff exponencial, até oito tentativas. Leases de 60 segundos recuperam processos interrompidos. Após 23 horas da primeira tentativa, resultados incertos passam a revisão manual, evitando repetir uma chamada após a janela de deduplicação do provedor. Uma atualização não pode recolher um e-mail cuja chamada já estava em andamento. A garantia depende da janela de idempotência do serviço, não é uma promessa de entrega exatamente uma vez na caixa de entrada.

Referência utilizada: [Idempotency Keys do Resend](https://resend.com/changelog/idempotency-keys). A interface distingue “aceito pelo provedor” de entrega efetiva; não há integração de webhooks de bounce/entrega nesta versão. Consulte o provedor para esses resultados.

## Dados e segurança

- Senhas com salt e scrypt; cookies de sessão HttpOnly, SameSite=Lax e Secure em HTTPS; tokens armazenados como hash e expiração em sete dias.
- Validação de origem em operações de escrita, consultas parametrizadas, escopo de proprietário no servidor, CSP e limitação de tentativas de autenticação.
- Controle otimista de versão: edição antiga recebe erro de conflito e não sobrescreve o registro mais novo. Os campos permanecem no editor; copie suas mudanças e recarregue antes de reconciliar.
- JPEG/PNG/PDF até 5 MB, validados por assinatura e tipo. Capas aceitam apenas imagens na interface. PDFs são baixados como anexos. Downloads exigem a mesma conta proprietária.
- Banco e anexos ficam fora da pasta pública. Remover um anexo do card desvincula o arquivo; o binário permanece no volume até limpeza administrativa. Não há antivírus nem quota global nesta versão.
- Contas são isoladas, mas administradores do servidor têm acesso aos dados no volume. Use disco criptografado e backups protegidos. Não foi realizada auditoria externa de segurança.
- Não há recuperação automática de senha nesta versão; trate isso no suporte operacional antes de abrir o serviço para um público amplo.

## Testes e qualidade

```sh
npm run lint
npm run check
npm test
npm run build
```

`lint` verifica sintaxe de todos os módulos, a ausência de `debugger` e a formatação com Prettier. `check` usa TypeScript estrito nos contratos e no núcleo de datas/agendamento por JSDoc. As camadas HTTP e de interface permanecem JavaScript e são verificadas por sintaxe e testes, não têm cobertura estática completa.

Os testes usam bancos temporários independentes e remetente simulado, sem enviar mensagens. Cobrem autenticação, isolamento entre contas, conflito de versões, CRUD essencial, anexos inválidos, cascata de exclusão, sincronização card/calendário, datas inválidas, três lembretes, proximidade do prazo, horário de verão, concorrência, falhas transitórias, payload idempotente, retomada de lease e janela segura de revisão.

O build copia apenas a aplicação e os manifests para `dist/`; não inclui `.env`, banco ou anexos. O navegador foi verificado manualmente na prévia local; os testes automatizados são de API e núcleo, não uma suíte E2E de navegador.

## Ambientes e CI/CD

A publicação de imagem e o deploy ficam desativados por padrão. Habilite a variável
de repositório `DEPLOY_ENABLED=true` somente depois de configurar os ambientes,
secrets e servidor de destino. O envio do código continua executando as verificações.

Não envie `.env`, `data/`, bancos, anexos, backups ou chaves privadas ao GitHub.
O arquivo `.env.example` contém somente nomes de variáveis e exemplos sem credenciais.
Configure credenciais reais em GitHub Actions Secrets ou no ambiente do servidor.

Use três instalações independentes:

| Ambiente        | Origem                                   | Banco, anexos e credenciais                       |
| --------------- | ---------------------------------------- | ------------------------------------------------- |
| Desenvolvimento | localhost                                | `data/` e `.env` local                            |
| Homologação     | branch `develop` / environment `staging` | Servidor/volume, remetente e secrets próprios     |
| Produção        | branch `main` / environment `production` | Outro servidor/volume, domínio e secrets próprios |

O workflow `.github/workflows/ci.yml` executa instalação reproduzível pelo lockfile, verificações, testes e build. Somente depois, publica imagem Docker com tag do commit no GHCR e faz o deploy por SSH. Pull requests executam somente verificações. Configure revisão obrigatória de PRs e aprovação no GitHub Environment `production` antes de ativar o pipeline; essas políticas não podem ser impostas por este arquivo local.

Preparação em **cada servidor**:

1. Instale Docker Engine e Compose v2, crie `/srv/aurora` pertencente ao usuário de deploy e copie `deploy/compose.yml` e `deploy/release.sh`.
2. Crie `/srv/aurora/.env` com `APP_URL=https://seu-dominio`, `EMAIL_FROM`, `RESEND_API_KEY` e um `MONITOR_TOKEN` aleatório (32 bytes ou mais). Permissão `chmod 600 .env`.
3. Autorize leitura da imagem privada GHCR no Docker do servidor. Não copie o token de escrita do pipeline para o servidor.
4. Configure DNS e proxy HTTPS, usando `deploy/Caddyfile.example` como base. O serviço só publica sua porta no loopback; o proxy é o ponto de entrada HTTPS.
5. No GitHub, crie os environments `staging` e `production`. Cada um precisa de `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_KNOWN_HOSTS` (fingerprint verificado fora do pipeline). A chave deve acessar somente o host apropriado.
6. Envie o projeto a um repositório e configure as branches protegidas. O deploy utiliza `/srv/aurora` em hosts separados para os dois ambientes.

Os arquivos de workflow são configuração pronta para integração, não evidência de um deploy remoto realizado. Testes locais não substituem smoke tests de HTTPS, persistência entre reinícios e recebimento real de e-mails no ambiente de homologação.

## Migrações e rollback

Migração inicial versionada em `src/db.js`, aplicada dentro de transação e registrada na tabela `migrations`. Para evoluções, adicione nova versão de migração; não reescreva uma migração já aplicada. Use alterações aditivas compatíveis com a versão anterior e migrações de dados separadas.

`release.sh` baixa a imagem, faz backup consistente SQLite pela API `backup`, sobe o serviço e aguarda o healthcheck. Se falhar, restaura a imagem anterior. A imagem anterior também fica em `previous-image`. O volume mantém os registros entre releases. A automação não restaura o banco automaticamente, porque isso pode perder gravações recentes.

Para rollback manual: exporte `AURORA_IMAGE` com a tag salva em `previous-image` e execute `docker compose -f compose.yml up -d --wait`. Se uma migração futura não for retrocompatível, pare o serviço, preserve o volume atual e restaure um backup validado, considerando explicitamente as gravações após o backup.

Os backups de release cobrem o banco. Configure também backup periódico do volume completo, incluindo `uploads/`, em armazenamento externo criptografado, e teste a restauração. Não existe cópia externa de backup configurada nesta entrega.

## Monitoramento

- `/healthz`: disponibilidade do processo e banco.
- `/api/monitor`: contagem por estado da fila e pendência mais antiga, protegido por Bearer `MONITOR_TOKEN`.
- Logs JSON em stderr para erros de requisição, execução e e-mail; tentativas também ficam na tabela `mail_logs`.
- Workflow `monitor.yml`: consulta o endpoint a cada 15 minutos quando `MONITOR_ENABLED=true`; configure `METRICS_URL` e `MONITOR_TOKEN` no environment separado `monitoring` (sem aprovação manual por execução). Ele falha quando encontra erro permanente, revisão necessária, e-mail sem configuração ou atraso maior que uma hora. Habilite as notificações de falha do GitHub para a equipe responsável. Agendamentos GitHub podem atrasar; use monitor dedicado para SLA estrito.

Para a primeira ativação, confirme: servidor acessível em HTTPS, conta confirmada, três lembretes futuros na fila, recebimento de um lembrete real em homologação, atualização/cancelamento de prazos, backup e rollback exercitados. Nenhum desses serviços externos foi configurado silenciosamente.
