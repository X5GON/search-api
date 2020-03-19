require("module-alias/register");

// async values handler
const async = require("async");

// import configurations
const config = require("@config/config");
const pg = require("@library/postgresQL")(config.pg);
const ElasticSearch = require("../library/elasticsearch");

const es = new ElasticSearch({ node: "http://127.0.0.1:9200" });

// internal modules
const mimetypes = require("@config/mimetypes");

/**
 * Returns the general material type.
 * @param {String} mimetype - The document mimetype.
 * @returns {String|Null} The material type.
 */
function materialType(mimetype) {
    for (let type in mimetypes) {
        if (mimetypes[type].includes(mimetype)) {
            return type;
        }
    }
    return null;
}

// merges all of the material information into a single line
const pg_command = `
    WITH URLS AS (
        SELECT
            COALESCE(m.material_id, c.material_id) AS material_id,
            COALESCE(m.provider_id, c.provider_id) AS provider_id,
            m.url AS material_url,
            c.url AS website_url
        FROM contains
        LEFT JOIN urls m ON contains.contains_id = m.id
        LEFT JOIN urls c ON contains.container_id = c.id
        ORDER BY material_id
    ),

    OERS AS (
        SELECT
            URLS.material_id,
            oer.title,
            oer.description,
            oer.creation_date,
            oer.retrieved_date,
            oer.type,
            oer.mimetype,
            URLS.material_url,
            URLS.website_url,

            oer.language,
            oer.license,

            p.name AS provider_name,
            URLS.provider_id,
            p.domain AS provider_url

        FROM URLS
        LEFT JOIN oer_materials oer ON URLS.material_id = oer.id
        LEFT JOIN providers     p   ON URLS.provider_id = p.id
    ),

    CONTENTS AS (
        SELECT
            oer_materials.id as material_id,
            json_agg(json_build_object('content_id', c.id, 'type', c.type, 'extension', c.extension, 'language', c.language, 'value', c.value->>'value')) AS contents
        FROM oer_materials
        LEFT JOIN material_contents c ON c.material_id = oer_materials.id
        GROUP BY oer_materials.id
    )

    SELECT
        OERS.*,
        CONTENTS.contents,
        cast(fp.value->>'value' AS json) as wikipedia
    FROM OERS
    LEFT JOIN CONTENTS ON CONTENTS.material_id = OERS.material_id
    LEFT JOIN features_public AS fp ON fp.record_id=OERS.material_id
    WHERE fp.table_name='oer_materials' AND fp.name='wikipedia_concepts'
    ORDER BY OERS.material_id DESC;
`;
console.log("preparation");
async function populate() {
    console.log("deleting index");
    // delete the existing index
    await es.deleteIndex("oer_materials");

    console.log("creating index");
    // the index does not exist yet
    await es.createIndex({
        index: "oer_materials",
        body: {
            mappings: {
                properties: {
                    material_id: { type: "long" },
                    title: { type: "text" },
                    description: { type: "text" },
                    creation_date: { type: "date" },
                    retrieved_date: { type: "date" },
                    type: { type: "keyword" },
                    extension: { type: "keyword" },
                    mimetype: { type: "keyword" },
                    material_url: { type: "keyword" },
                    website_url: { type: "keyword" },

                    provider_name: { type: "keyword" },
                    provider_id: { type: "long" },
                    provider_url: { type: "keyword" },

                    language: { type: "keyword" },

                    license: {
                        type: "object",
                        properties: {
                            short_name: { type: "keyword" },
                            disclaimer: { type: "text" },
                            url: { type: "keyword" }
                        }
                    },

                    contents: {
                        type: "nested",
                        properties: {
                            content_id: { type: "long" },
                            type: { type: "keyword" },
                            extension: { type: "keyword" },
                            language: { type: "keyword" },
                            value: { type: "text" }
                        }
                    },

                    wikipedia: {
                        type: "nested",
                        properties: {
                            lang: { type: "keyword" },
                            uri: { type: "keyword" },
                            name: { type: "text" },
                            sec_uri: { type: "keyword" },
                            sec_name: { type: "text" },
                            db_pedia_iri: { type: "keyword" },
                            cosine: { type: "float" },
                            pagerank: { type: "float" },
                            support: { type: "long" }
                        }
                    }
                }
            }
        }
    });

    // set the default disclaimer parameter
    const NO_LICENSE_DISCLAIMER = "X5GON recommends the use of the Creative Commons open licenses. During a transitory phase, other licenses, open in spirit, are sometimes used by our partner sites.";
    const DEFAULT_DISCLAIMER = "The usage of the corresponding material is in all cases under the sole responsibility of the user.";

    let count = 0;
    const promise = new Promise((resolve, reject) => {

        console.log("executing pg-command");

        pg.executeLarge(pg_command, [], 100,
            (error, records, callback) => {
                if (error) { console.log(error); return; }

                let tasks = [];
                for (let record of records) {
                    if (!record.material_id) { continue; }

                    record.title = record.title.replace(/\r*\n+/g, " ").replace(/\t+/g, " ").trim();
                    if (record.description) {
                        record.description = record.description.replace(/\r*\n+/g, " ").replace(/\t+/g, " ").trim();
                    }
                    record.extension = record.type;
                    record.type = materialType(record.mimetype);

                    // modify the license attribute when sending to elasticsearch
                    const url = record.license;
                    let short_name;
                    let typed_name;
                    let disclaimer = DEFAULT_DISCLAIMER;

                    if (url) {
                        const regex = /\/licen[sc]es\/([\w\-]+)\//;
                        short_name = url.match(regex)[1];
                        typed_name = short_name.split("-");
                    } else {
                        short_name = NO_LICENSE_DISCLAIMER;
                    }
                    record.license = {
                        short_name,
                        typed_name,
                        disclaimer,
                        url
                    };

                    // modify the wikipedia array
                    for (let value of record.wikipedia) {
                        // rename the wikipedia concepts
                        value.sec_uri = value.secUri;
                        value.sec_name = value.secName;
                        value.pagerank = value.pageRank;
                        value.db_pedia_iri = value.dbPediaIri;
                        value.support = value.supportLen;
                        value.wiki_data_classes = value.wikiDataClasses;
                        // delete the previous values
                        delete value.secUri;
                        delete value.secName;
                        delete value.pageRank;
                        delete value.dbPediaIri;
                        delete value.supportLen;
                        delete value.wikiDataClasses;
                    }

                    tasks.push((xcallback) => {
                        es.pushRecord("oer_materials", record, record.material_id)
                            .then((results) => {
                                count++;
                                xcallback(null);
                            })
                            .catch((error) => xcallback);
                    });
                }

                async.series(tasks, (xerror) => {
                    if (xerror) { console.log(xerror); }
                    if (count % 10000 === 0) {
                        console.log("Currently processed:", count, "OER materials");
                    }
                    callback();
                });
            }, (error) => {
                // close connection
                pg.close();
                if (error) { return reject(error); }
                // close the postgres connection
                return resolve();
            });
    });

    await promise;
    console.log("refreshing index");
    // force the index to refresh to get the results
    await es.refreshIndex("oer_materials");

    console.log("done");
}

populate().catch((error) => {
    console.log(error.meta.body);
});
