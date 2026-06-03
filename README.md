# 🚦 Maply — Monitoramento Urbano Colaborativo

## Sobre o Projeto

O **Maply** é uma plataforma de monitoramento urbano colaborativo que utiliza inteligência coletiva e dados em tempo real para melhorar a mobilidade, a segurança e a qualidade de vida nas cidades.

Através de um mapa interativo, cidadãos podem registrar ocorrências urbanas, visualizar problemas reportados por outros usuários e acompanhar a situação das vias em tempo real.

---

# 🎯 Problema Resolvido

Atualmente, a comunicação entre cidadãos e órgãos responsáveis pela gestão urbana é fragmentada e pouco eficiente.

Problemas como:

* Buracos na via
* Alagamentos
* Semáforos quebrados
* Falta de sinalização
* Obras sem aviso prévio
* Acúmulo de lixo em vias públicas

normalmente são reportados por diferentes canais e dificilmente ficam visíveis para toda a população.

O **Maply** centraliza essas informações em uma única plataforma georreferenciada, permitindo que cidadãos identifiquem áreas problemáticas, evitem rotas comprometidas e contribuam para uma cidade mais eficiente.

---

# 👥 Equipe

* Arthur Wolf
* Miguel Wolf
* Eduardo Romeiro
* Nahuel Ramiro
* Júlia herdina

---

# 🛠 Tecnologias Utilizadas

## Backend

* Node.js
* Express.js

## Banco de Dados

* PostgreSQL
* Supabase

## Autenticação

* JWT (JSON Web Tokens)
* Bcrypt

## Frontend

* HTML5
* CSS3
* JavaScript (Vanilla JS)

## Mapas e Geolocalização

* Leaflet.js
* OpenStreetMap

## APIs Externas

### TomTom API

Utilizada para:

* Fluxo de trânsito em tempo real
* Incidentes de trânsito
* Camadas premium de mobilidade

### Nominatim (OpenStreetMap)

Utilizada para:

* Geocodificação de endereços
* Conversão de endereços em coordenadas geográficas

### ViaCEP

Utilizada para:

* Validação de CEPs
* Preenchimento automático de endereços

---

# ✨ Funcionalidades

## Cadastro de Ocorrências

Os usuários podem registrar ocorrências contendo:

* Tipo
* Descrição
* Endereço
* CEP
* Severidade
* Status

---

## Geocodificação Inteligente

Conversão automática de:

* CEP → Coordenadas
* Endereço → Coordenadas

permitindo posicionamento automático no mapa.

---

## Mapa Interativo

Visualização em tempo real das ocorrências com:

* Zoom dinâmico
* Popups informativos
* Tema claro e escuro
* Agrupamento geográfico

---

## Sistema de Favoritos

Usuários autenticados podem:

* Favoritar ocorrências
* Visualizar favoritos destacados
* Destacar ocorrências favoritas no mapa

---

## Sistema de Votação

Permite que usuários indiquem relevância das ocorrências através de votos.

---

## Controle de Cotas

### Usuários Gratuitos

* 1 ocorrência a cada 24 horas

### Usuários Premium

* Criação ilimitada de ocorrências

---

## Plano Premium

Inclui:

* Todas as ocorrências com localização exata
* Camadas TomTom
* Dados de trânsito em tempo real
* Relatórios avançados
* Indicadores de risco por região

---

## Relatório Inteligente de Risco

O sistema calcula automaticamente um **Danger Score** baseado em:

* Quantidade de ocorrências
* Severidade
* Status das ocorrências
* Região afetada

Gerando indicadores úteis para análise urbana.

---

# 🗄 Estrutura do Banco de Dados

## users

Armazena:

* Nome
* E-mail
* Senha criptografada
* Bairro preferencial
* Plano ativo
* Data de expiração da assinatura

---

## ocorrencias

Armazena:

* Tipo
* Descrição
* Localização
* Coordenadas
* Severidade
* Status
* Votos
* Usuário responsável

---

## favoritos

Relaciona:

* Usuário
* Ocorrência favoritada

---

## pagamentos

Armazena:

* Plano contratado
* Status da assinatura
* Datas de renovação
* Histórico de pagamento

---

# 💰 Modelo de Monetização

## Gratuito

* Visualização de ocorrências médias e altas
* Localização aproximada
* 1 ocorrência por dia

---

## Premium — R$ 19,90/mês

* Visualização completa das ocorrências
* Localização exata
* Trânsito em tempo real
* Incidentes TomTom
* Relatórios avançados
* Indicadores de resolução por bairro
* Estatísticas exclusivas

---

# 🚀 Instalação Local

## Pré-requisitos

* Node.js 18+
* PostgreSQL ou Supabase
* Conta TomTom (opcional)

---

## 1. Clonar o projeto

```bash
git clone https://github.com/seu-usuario/maply.git
cd maply
```

## 2. Instalar dependências

```bash
npm install
```

## 3. Criar arquivo .env

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/database

JWT_SECRET=sua_chave_super_secreta

PORT=3000

TOMTOM_API_KEY=sua_chave_tomtom
```

## 4. Iniciar o servidor

```bash
npm start
```

ou

```bash
node server.js
```

---

## 5. Acessar a aplicação

```text
http://localhost:3000
```

---

# 📍 Principais Diferenciais

* Monitoramento urbano colaborativo
* Geocodificação automática
* Integração com TomTom Traffic
* Sistema Freemium
* Relatórios inteligentes
* Favoritos e personalização
* Interface Urban Brutalist
* Foco em cidades brasileiras

---

# 📄 Licença

Projeto desenvolvido para fins acadêmicos, experimentais e de inovação urbana.

Todos os direitos reservados © Maply.
