# StarUP PWA

PWA em HTML/CSS/JavaScript com sessão na mesma origem da API Django. Inclui vitrine pública offline, cadastro por papel, propostas, entrega e avaliação. Investidor permanece em modo leitor privado.

Execute o backend no repositório irmão: ele serve estes arquivos na mesma origem. Consulte ../starup-backend/docs/development.md para configurar PostgreSQL, Redis e Docker Compose. Não abra index.html diretamente nem use um servidor separado sem proxy para /api/.

Testes de cache: node --test tests/service-worker.test.cjs. Para cada mudança no shell, incremente VERSION em service-worker.js para que a atualização preserve formulários até o usuário confirmar o recarregamento.

A atualização para StarUP limpa caches da marca anterior quando ativada e migra a referência local da inscrição push. O identificador de instalação do manifesto permanece `/`. As referências ao nome anterior no código existem somente para essa compatibilidade; os créditos originais em LICENSE foram preservados.
