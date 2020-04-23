# Configuration

This folder contains the configuration files.

## Environment Variables

To avoid storing vulnerable data in the repository (such as authentication tokens
and secrets) we have adopted the `.env` approach to feed the vulnerable data to
different components of the platform.

This approach requires the `dotenv` module (which is installed by running the
`npm install` command) and an `.env` file saved in this folder. One must create the
`.env` file by hand since it is ignored in the project.

### .env
What follows is an example of the `.env` file. To get the right tokens contact
one of the developers contributing to this project.

```bash
#######################################
### Production variables
#######################################

PROD_PORT={production-service-port: integer}
PROD_SESSION_SECRET={production-session-secret: string}
PROD_ELASTICSEARCH_NODE={production-elasticsearch-node: address:port}

PROD_CREATIVECOMMONS_TOKEN={cc-token}

#######################################
### Development variables
#######################################

DEV_PORT={development-service-port: integer}
DEV_SESSION_SECRET={development-session-secret: string}
DEV_ELASTICSEARCH_NODE={development-elasticsearch-node: address:port}

DEV_CREATIVECOMMONS_TOKEN={cc-token}

#######################################
### Test variables
#######################################

TEST_PORT={test-service-port: integer}
TEST_SESSION_SECRET={test-session-secret: string}
TEST_ELASTICSEARCH_NODE={test-elasticsearch-node: address:port}

TEST_CREATIVECOMMONS_TOKEN={cc-token}
```

## Creative Commons Token

Part of the search, the part for retrieving CC images, is done through the use
of the Creative Commons Search API:
https://api.creativecommons.engineering/v1/

Although the API is free for use, registered users can make more
queries to the API. Follow the instructions on the above link to
register and get a creative commons token.