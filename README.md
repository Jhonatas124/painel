# Painel de Bolso

Web app pessoal (PWA) para iPhone e Mac: o painel de vendas e do canal (de onde veio a venda, qual vídeo vende,
métricas do YouTube, Meta Ads, concorrência).

- Este repositório tem **só o código**. Nenhum dado fica aqui.
- Os dados chegam de um computador do dono, **criptografados** (AES-256-GCM, chave trancada com RSA-OAEP-3072),
  num repositório **privado** do GitHub dele. Só o app abre, com a senha do cofre.
- Sem servidor e sem conta. As vendas são buscadas ao vivo no recebedor do dono (endereço guardado no cofre).

Publicação: GitHub Pages, branch `main`, pasta raiz. No iPhone: Safari › Compartilhar › Adicionar à Tela de Início.
