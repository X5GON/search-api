# X5GON Search API

![Node][programming-language]
![Node.js CI][github-action]
[![Linux Build][linux-build]][linux-build-status]
[![OSX Build][osx-build]][osx-build-status]
[![License][license]][license-link]

This project contains the code base for the X5GON search API. It connects to the [Elasticsearch][elasticsearch]
service and allows to search through the documents using different criteria.

## Prerequisites

- A running Elasticsearch service (one can download and install it from [here][elasticsearch-download]
  or use a [docker image][elasticsearch-docker])
- NodeJS version `10.x`, `12.x` or `>=14.x`

  To test that your nodejs version is correct, run `node --version` in the command line.

## Installation

- Have a running elasticsearch service

- Create a `.env` file in the [/env](./env) folder (see [instructions](./env)).

- Install the nodejs dependencies:

  ```bash
  npm install
  ```

- Build the project components:
  ```bash
  npm run build
  ```
  The built components will be available in the `./dist` folder.

## Populating the Elasticsearch Index

Before running the service one must have a populated elasticsearch index. Assuming that the PostgreSQL
database is populated with the material documents one can run the loading script:

```bash
cd load && node create-elasticsearch-index
```

The script contains the schema of the elasticsearch index and the logic on how to bundle the material
metadata into the index.

## Running the Search API manually

To manually start the Search API service one must simply run the following command:

```bash
# running in development environment
npm start
# running in production environment
cd ./dist && NODE_ENV=production node search.js
```

This will start the service in the terminal.

## Running the Search API using PM2

One can also run the search API using [PM2](https://pm2.keymetrics.io/). This will run the service
in the background, will automatically restart if the service crashes and is fully configurable
through the [./ecosystem.config.yml](./ecosystem.config.yml) file.

To install PM2 one must run

```bash
npm install -g pm2
```

To run the service using PM2 one must simply run the following command:

```bash
pm2 start ecosystem.config.yml [--env production]
```

This will run the service in the background. To control the pm2 services please see
their [documentation](https://pm2.keymetrics.io/docs/usage/quick-start/).

[programming-language]: https://img.shields.io/badge/node-%3E%3D%2010.0.0-green.svg
[github-action]: https://github.com/X5GON/search-api/workflows/Node.js%20CI/badge.svg
[linux-build]: https://img.shields.io/travis/X5GON/search-api/master.svg?label=linux
[linux-build-status]: https://travis-ci.org/X5GON/search-api
[osx-build]: https://img.shields.io/travis/X5GON/search-api/master.svg?label=mac
[osx-build-status]: https://travis-ci.org/X5GON/search-api
[license]: https://img.shields.io/badge/License-BSD%202--Clause-green.svg
[license-link]: https://opensource.org/licenses/BSD-2-Clause
[elasticsearch]: https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html
[elasticsearch-download]: https://www.elastic.co/downloads/elasticsearch
[elasticsearch-docker]: https://hub.docker.com/_/elasticsearch
