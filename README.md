# Criar pasta data(plans.json , users.example.json , users.json) e test(server.test.js)

# FORMA

Site de acompanhamento com contas locais no servidor e planos individuais de treino e alimentação.

## Preparar

Instala o Node.js 20 ou mais recente. Na pasta do projeto, edita `data/users.json` (se não existir, copia `data/users.example.json` para esse nome). Este ficheiro é privado e não deve ser publicado nem incluído em repositórios ou backups públicos.

Para cada utilizador, executa `npm run password` num terminal interativo e introduz uma palavra-passe de pelo menos 12 caracteres. Copia o valor gerado para o ficheiro, mantendo o formato JSON:

```json
[
  {
    "name": "Nome do gestor",
    "email": "gestor@example.com",
    "passwordHash": "VALOR_GERADO_PELO_COMANDO",
    "role": "admin"
  },
  {
    "name": "Nome do aluno",
    "email": "aluno@example.com",
    "passwordHash": "VALOR_GERADO_PELO_COMANDO",
    "role": "aluno"
  }
]
```

Usa emails únicos em minúsculas e cria uma palavra-passe protegida diferente para cada pessoa. Edita o ficheiro diretamente para adicionar utilizadores, alterar funções ou revogar acessos; remover um utilizador ou alterar a sua palavra-passe invalida a sessão existente. A palavra-passe original nunca deve ser escrita no ficheiro. O ficheiro `data/plans.json` é criado automaticamente e também deve permanecer privado.

Executa `npm start` e abre `http://localhost:3000`. Na área Gestão, o gestor seleciona um aluno e guarda os planos de treino e dieta separadamente. No treino pode definir exercícios, séries, repetições e descanso para cada dia; o aluno vê apenas os dias com exercícios. Na dieta pode preencher pequeno-almoço, lanches, almoço, jantar e ceia, ou adicionar outras refeições. Pode indicar as kcal de cada refeição para serem somadas quando o aluno a marcar como consumida. As refeições antigas sem kcal continuam disponíveis, mas não contribuem para o total até o gestor preencher esse valor. As marcações são individuais por dia e navegador; desmarcar retira as respetivas kcal. Os registos manuais também são somados, pelo que a mesma refeição não deve ser registada duas vezes. Se o conteúdo de uma refeição mudar, a respetiva marcação é reiniciada. Os planos existentes permanecem disponíveis ao editar a outra secção.

Os planos e as contas ficam em ficheiros no servidor; os registos de refeições e água ficam separados por conta no navegador utilizado, não sincronizam entre dispositivos e podem ser apagados quando os dados do navegador forem limpos. Os registos da versão anterior sem login não são importados automaticamente.

## Publicação

Não publiques este site apenas como ficheiros estáticos. Executa **uma instância** do servidor Node num serviço persistente, atrás de um proxy HTTPS, e configura `PUBLIC_ORIGIN` com a origem pública exata, por exemplo `https://exemplo.pt`. O servidor escuta apenas em `127.0.0.1`; o proxy deve encaminhar pedidos para a porta definida em `PORT` (3000 por defeito). Ativa HTTPS antes de disponibilizar o site e não exponhas a porta interna diretamente.

Guarda `data/users.json` e `data/plans.json` num volume privado e persistente, protegido com permissões restritas e cópias de segurança; alternativamente define `FORMA_DATA_DIR` para uma pasta privada persistente. O login fica guardado num cookie HttpOnly e a sessão expira ao fim de uma semana; terminar sessão ou reiniciar o servidor também invalida o acesso. O servidor só disponibiliza os ficheiros públicos numa lista explícita. Não uses múltiplas instâncias: as sessões são mantidas em memória e os ficheiros não têm coordenação entre processos.

Configura também limitação de pedidos no proxy por endereço real do cliente: o limite interno vê o endereço do proxy quando existe um proxy reverso. Para utilização pública, avalia com um profissional a segurança do alojamento, a proteção dos dados pessoais e as obrigações legais aplicáveis.

## Testes

Executa `npm test`. Os testes usam uma pasta temporária própria e não alteram as contas ou planos reais.
