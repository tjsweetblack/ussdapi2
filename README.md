# USSD Service Integration with Africastalking

Este projeto implementa um serviço simples USSD utilizando o Africastalking, com menus interativos e respostas baseadas em opções selecionadas pelos usuários.

## Funcionalidades

- Menu inicial com opções.
- Respostas personalizadas para cada opção.
- Mensagem de erro para opções inválidas.

## Instalação

1. Clone o repositório:
   
   ```bash
   git clone https://github.com/seu-usuario/ussd_africastalking.git
   cd ussd_africastalking

   ```
3. Instale as dependências:
   
   ```bash
    npm install
    ```
   
4. Inicie o servidor:
   
  ```bash
  node server.js
  ```

## Uso
O servidor estará rodando na porta 3000 por padrão.

O endpoint principal é /ussd, que recebe dados do Africastalking.

### Tecnologias

* Node.js

* Express

* body-parser

### Contribuindo

- Faça o fork do projeto.

- Crie uma branch para sua feature (git checkout -b minha-feature).

- Commit suas alterações (git commit -am 'Adiciona nova funcionalidade').

- Envie para a branch principal (git push origin minha-feature).

- Abra um Pull Request.

# Licença
Este projeto está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.
