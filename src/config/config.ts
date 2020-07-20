/**
 * Microservice configuration variables
 * It generates the configuration object used across
 * the microservice. This object contains the environment
 * variables.
 */

import * as Interfaces from "../Interfaces";

// external modules
import * as path from "path";
// import the secret node variables
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../env/.env") });

// get process environment
const env = process.env.NODE_ENV || "development";

// the common environment
const common = {
    environment: env,
    isProduction: env === "production"
    // TODO: add common variables
};

// production environment variables
const production = {
    // TODO: add production variables
    port: parseInt(process.env.PROD_PORT, 10) || 3100,
    sessionsecret: process.env.PROD_SESSION_SECRET,
    elasticsearch: {
        node: process.env.PROD_ELASTICSEARCH_NODE
    },
    creativecommons: {
        token: process.env.PROD_CREATIVECOMMONS_TOKEN,
        source: [
            'wikimedia', 'thorvaldsensmuseum', 'thingiverse', 'svgsilh', 'statensmuseum',
            'spacex', 'smithsonian', 'sketchfab', 'sciencemuseum', 'rijksmuseum', 'rawpixel',
            'phylopic', 'nypl', 'nasa', 'museumsvictoria', 'met', 'mccordmuseum', 'iha',
            'geographorguk', 'floraon', 'flickr', 'europeana', 'eol', 'digitaltmuseum',
            'deviantart', 'clevelandmuseum', 'brooklynmuseum', 'bio_diversity', 'behance',
            'animaldiversity', 'WoRMS', 'CAPL', '500px'
        ]
    },
    pg: {
        host: process.env.PROD_PG_HOST || "127.0.0.1",
        port: parseInt(process.env.PROD_PG_PORT, 10) || 5432,
        database: process.env.PROD_PG_DATABASE || "x5gon",
        max: parseInt(process.env.PROD_PG_MAX, 10) || 10,
        idleTimeoutMillis: parseInt(process.env.PROD_PG_IDLE_TIMEOUT_MILLIS, 10) || 30000,
        user: process.env.PROD_PG_USER || "postgres",
        password: process.env.PROD_PG_PASSWORD,
        schema: process.env.PROD_PG_SCHEMA || "public",
        version: process.env.PROD_PG_VERSION || "*"
    }
};

// development environment variables
const development = {
    // TODO: add development variables
    port: parseInt(process.env.DEV_PORT, 10) || 3101,
    sessionsecret: process.env.DEV_SESSION_SECRET,
    elasticsearch: {
        node: process.env.DEV_ELASTICSEARCH_NODE
    },
    creativecommons: {
        token: process.env.DEV_CREATIVECOMMONS_TOKEN,
        source: [
            'wikimedia', 'thorvaldsensmuseum', 'thingiverse', 'svgsilh', 'statensmuseum',
            'spacex', 'smithsonian', 'sketchfab', 'sciencemuseum', 'rijksmuseum', 'rawpixel',
            'phylopic', 'nypl', 'nasa', 'museumsvictoria', 'met', 'mccordmuseum', 'iha',
            'geographorguk', 'floraon', 'flickr', 'europeana', 'eol', 'digitaltmuseum',
            'deviantart', 'clevelandmuseum', 'brooklynmuseum', 'bio_diversity', 'behance',
            'animaldiversity', 'WoRMS', 'CAPL', '500px'
        ]
    },
    pg: {
        host: process.env.DEV_PG_HOST || "127.0.0.1",
        port: parseInt(process.env.DEV_PG_PORT, 10) || 5432,
        database: process.env.DEV_PG_DATABASE || "x5gon",
        max: parseInt(process.env.DEV_PG_MAX, 10) || 10,
        idleTimeoutMillis: parseInt(process.env.DEV_PG_IDLE_TIMEOUT_MILLIS, 10) || 30000,
        user: process.env.DEV_PG_USER || "postgres",
        password: process.env.DEV_PG_PASSWORD,
        schema: process.env.DEV_PG_SCHEMA || "public",
        version: process.env.DEV_PG_VERSION || "*"
    }
};

// test environment variables
const test = {
    // TODO: add test variables
    port: parseInt(process.env.TEST_PORT, 10) || 3102,
    sessionsecret: process.env.TEST_SESSION_SECRET,
    elasticsearch: {
        node: process.env.TEST_ELASTICSEARCH_NODE
    },
    creativecommons: {
        token: process.env.TEST_CREATIVECOMMONS_TOKEN,
        source: [
            'wikimedia', 'thorvaldsensmuseum', 'thingiverse', 'svgsilh', 'statensmuseum',
            'spacex', 'smithsonian', 'sketchfab', 'sciencemuseum', 'rijksmuseum', 'rawpixel',
            'phylopic', 'nypl', 'nasa', 'museumsvictoria', 'met', 'mccordmuseum', 'iha',
            'geographorguk', 'floraon', 'flickr', 'europeana', 'eol', 'digitaltmuseum',
            'deviantart', 'clevelandmuseum', 'brooklynmuseum', 'bio_diversity', 'behance',
            'animaldiversity', 'WoRMS', 'CAPL', '500px'
        ]
    },
    pg: {
        host: process.env.TEST_PG_HOST || "127.0.0.1",
        port: parseInt(process.env.TEST_PG_PORT, 10) || 5432,
        database: process.env.TEST_PG_DATABASE || "x5gon",
        max: parseInt(process.env.TEST_PG_MAX, 10) || 10,
        idleTimeoutMillis: parseInt(process.env.TEST_PG_IDLE_TIMEOUT_MILLIS, 10) || 30000,
        user: process.env.TEST_PG_USER || "postgres",
        password: process.env.TEST_PG_PASSWORD,
        schema: process.env.TEST_PG_SCHEMA || "public",
        version: process.env.TEST_PG_VERSION || "*"
    }
};

const envGroups = {
    production,
    development,
    test
};

// creates a deep merge between two JSON objects
function merge(target: Interfaces.IConfigCommon, source: Interfaces.IConfigENV): Interfaces.IConfiguration {
    // Iterate through `source` properties
    // If an `Object` set property to merge of `target` and `source` properties
    for (const key of Object.keys(source)) {
        if (source[key] instanceof Object && !Array.isArray(source[key])) {
            Object.assign(source[key], merge(target[key], source[key]));
        }
    }
    // Join `target` and modified `source`
    return Object.assign(target || {}, source);
}

// export the environment variables
const config = merge(common, envGroups[env]);
export default config;
