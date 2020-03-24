# NodeJS Elasticsearch Microservice

[![Build Status](https://travis-ci.com/ErikNovak/template-nodejs-elasticsearch-microservice.svg?branch=master)](https://travis-ci.com/ErikNovak/template-nodejs-elasticsearch-microservice)
![Node.js CI](https://github.com/ErikNovak/X5GON-elasticsearch-microservice/workflows/Node.js%20CI/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D%2010.0.0-green.svg)
![Platform](https://img.shields.io/badge/platform-linux-green.svg)
[![License](https://img.shields.io/badge/License-BSD%202--Clause-green.svg)](https://opensource.org/licenses/BSD-2-Clause)

The template repository for setting up the NodeJS microservice for connecting and using [Elasticsearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html).

## Prerequisites
- A running Elasticsearch service (one can download and install it from [here](https://www.elastic.co/downloads/elasticsearch))
- NodeJS version 10 or greater

    To test that your nodejs version is correct, run `node --version` in the command line.

## Install

To install the project run
```bash
npm install
```

## Starting the Microservice
To start the microservice in development mode run the following command

1. Build the project with the following command
    ```bash
    npm run build
    ```
    This will build the typescript code and copy it into the `/dist` folder

2. Configure the `.env` file in the `/env` folder as described [here](./env/README.md).
3. Start the project by running
    ```bash
    npm start
    ```



